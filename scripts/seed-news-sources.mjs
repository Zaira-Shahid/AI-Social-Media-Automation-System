/**
 * Seed the verified news sources (spec §5).
 *
 *   npm run seed:sources           # add any that are missing
 *   npm run seed:sources -- --check  # only report reachability, write nothing
 *
 * §5 forbids inventing a feed URL and requires availability to be verified
 * before implementation. Every feed below was fetched and confirmed to return
 * a parseable RSS or Atom document on 2026-08-31. Ars Technica was a candidate
 * and is deliberately absent: it answers 403 to non-browser clients, and a
 * source that is known not to work is not a source.
 *
 * This is optional, not a first-boot fixture. Which publications a company
 * follows is an editorial decision; §4's topic direction is guidance for
 * discovery, not a list to bake in.
 *
 * Each feed is re-checked before it is written, so a publisher that has since
 * moved or blocked us is reported rather than stored as a source that will
 * only ever fail.
 */
import { parseArgs } from "node:util";

import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import Parser from "rss-parser";

const SOURCES = [
  {
    name: "TechCrunch AI",
    feedUrl: "https://techcrunch.com/category/artificial-intelligence/feed/",
    homepageUrl: "https://techcrunch.com/category/artificial-intelligence/",
    category: "AI",
    priority: 1,
  },
  {
    name: "VentureBeat AI",
    feedUrl: "https://venturebeat.com/category/ai/feed/",
    homepageUrl: "https://venturebeat.com/category/ai/",
    category: "AI",
    priority: 1,
  },
  {
    name: "WIRED AI",
    feedUrl: "https://www.wired.com/feed/tag/ai/latest/rss",
    homepageUrl: "https://www.wired.com/tag/artificial-intelligence/",
    category: "AI",
    priority: 2,
  },
  {
    name: "The Verge",
    feedUrl: "https://www.theverge.com/rss/index.xml",
    homepageUrl: "https://www.theverge.com",
    category: "Technology",
    priority: 3,
  },
  {
    name: "MIT News — AI",
    feedUrl: "https://news.mit.edu/rss/topic/artificial-intelligence2",
    homepageUrl: "https://news.mit.edu/topic/artificial-intelligence2",
    category: "Research",
    priority: 2,
  },
  {
    name: "OpenAI",
    feedUrl: "https://openai.com/blog/rss.xml",
    homepageUrl: "https://openai.com/news/",
    category: "Vendor",
    priority: 1,
  },
  {
    name: "Google — AI",
    feedUrl: "https://blog.google/technology/ai/rss/",
    homepageUrl: "https://blog.google/technology/ai/",
    category: "Vendor",
    priority: 2,
  },
  {
    name: "Google DeepMind",
    feedUrl: "https://deepmind.google/blog/rss.xml",
    homepageUrl: "https://deepmind.google/discover/blog/",
    category: "Research",
    priority: 2,
  },
  {
    name: "Hugging Face",
    feedUrl: "https://huggingface.co/blog/feed.xml",
    homepageUrl: "https://huggingface.co/blog",
    category: "Vendor",
    priority: 3,
  },
];

const { values } = parseArgs({ options: { check: { type: "boolean", default: false } } });

const required = [
  "FIREBASE_ADMIN_PROJECT_ID",
  "FIREBASE_ADMIN_CLIENT_EMAIL",
  "FIREBASE_ADMIN_PRIVATE_KEY",
];

const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0 && !values.check) {
  console.error(`Missing environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

const parser = new Parser({
  timeout: 20_000,
  headers: { "User-Agent": "ai-social-media-automation/1.0 (+internal news discovery)" },
});

async function check(feedUrl) {
  try {
    const feed = await parser.parseURL(feedUrl);
    return { ok: true, items: feed.items?.length ?? 0 };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

let db;

if (!values.check) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
  });

  db = getFirestore(process.env.FIREBASE_DATABASE_ID ?? "(default)");
}

let unreachable = 0;

for (const source of SOURCES) {
  const result = await check(source.feedUrl);

  if (!result.ok) {
    unreachable += 1;
    console.log(`UNREACHABLE  ${source.name}: ${result.error}`);
    continue;
  }

  if (values.check) {
    console.log(`OK           ${source.name} (${result.items} items)`);
    continue;
  }

  // Keyed on the feed URL so re-running does not create a second copy, and so
  // a source someone has since edited or deactivated is left alone.
  const existing = await db
    .collection("newsSources")
    .where("feedUrl", "==", source.feedUrl)
    .limit(1)
    .get();

  if (!existing.empty) {
    console.log(`EXISTS       ${source.name}`);
    continue;
  }

  await db.collection("newsSources").add({
    ...source,
    active: true,
    health: {
      status: "UNKNOWN",
      lastCheckedAt: null,
      lastSuccessAt: null,
      lastError: null,
      consecutiveFailures: 0,
      lastItemCount: null,
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: "seed-script",
  });

  console.log(`ADDED        ${source.name} (${result.items} items)`);
}

if (unreachable > 0) {
  console.log("");
  console.log(`${unreachable} of ${SOURCES.length} feeds did not respond and were not added.`);
}

process.exit(0);
