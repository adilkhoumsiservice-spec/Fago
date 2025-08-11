// scripts/fetch_and_publish.js
const fs = require("fs");
const path = require("path");
const Parser = require("rss-parser");
const axios = require("axios");

const DATA_FILE = path.join(process.cwd(), "data", "posted.json");
const RSS_FEED = process.env.RSS_FEED_URL || "https://feeds.bbci.co.uk/news/rss.xml";
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const HUGGINGFACE_MODEL = process.env.HUGGINGFACE_MODEL || "sshleifer/distilbart-cnn-6-6";
const FACEBOOK_PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const FACEBOOK_PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

if (!HUGGINGFACE_API_KEY) {
  console.error("Missing HUGGINGFACE_API_KEY (GitHub secret)");
  process.exit(1);
}
if (!FACEBOOK_PAGE_ID || !FACEBOOK_PAGE_ACCESS_TOKEN) {
  console.error("Missing FACEBOOK_PAGE_ID or FACEBOOK_PAGE_ACCESS_TOKEN (GitHub secrets)");
  process.exit(1);
}

const parser = new Parser();

function loadPosted() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      return { posted: [] };
    }
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw || '{"posted": []}');
  } catch (e) {
    return { posted: [] };
  }
}

function savePosted(obj) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(obj, null, 2), "utf8");
}

async function summarizeWithHF(text) {
  const url = `https://api-inference.huggingface.co/models/${HUGGINGFACE_MODEL}`;
  try {
    const resp = await axios.post(
      url,
      { inputs: text },
      {
        headers: { Authorization: `Bearer ${HUGGINGFACE_API_KEY}` },
        timeout: 30000
      }
    );
    const data = resp.data;
    // handle common response shapes
    if (Array.isArray(data) && data[0] && (data[0].summary_text || data[0].generated_text)) {
      return data[0].summary_text || data[0].generated_text;
    }
    if (typeof data === "string") return data;
    if (data && (data.summary_text || data.generated_text)) return data.summary_text || data.generated_text;
    // fallback: try to stringify
    return JSON.stringify(data).slice(0, 800);
  } catch (err) {
    console.error("HuggingFace error:", err.response?.data || err.message || err);
    return null;
  }
}

async function postToFacebook(message) {
  try {
    const url = `https://graph.facebook.com/${FACEBOOK_PAGE_ID}/feed`;
    const resp = await axios.post(
      url,
      null,
      {
        params: {
          message,
          access_token: FACEBOOK_PAGE_ACCESS_TOKEN
        },
        timeout: 20000
      }
    );
    return resp.data;
  } catch (err) {
    console.error("Facebook error:", err.response?.data || err.message || err);
    return null;
  }
}

(async () => {
  console.log("Starting fetch_and_publish job");
  const postedObj = loadPosted();
  const postedSet = new Set(postedObj.posted || []);

  let feed;
  try {
    feed = await parser.parseURL(RSS_FEED);
  } catch (e) {
    console.error("Failed to fetch RSS:", e.message || e);
    process.exit(1);
  }

  console.log("Items fetched:", (feed.items && feed.items.length) || 0);

  let postedThisRun = 0;
  for (const item of feed.items) {
    const id = item.guid || item.link || item.title;
    if (!id) continue;
    if (postedSet.has(id)) continue;

    const textForAI = `${item.title}\n\n${item.contentSnippet || item.content || item.summary || ""}`.slice(0, 4000);
    console.log("Summarizing:", item.title);

    const summary = await summarizeWithHF(textForAI);
    if (!summary) {
      console.warn("Skipping item due to summarization failure:", item.title);
      continue;
    }

    const message = `${summary}\n\nSource: ${item.link}`;
    const fbRes = await postToFacebook(message);
    if (fbRes && (fbRes.id || fbRes.post_id)) {
      console.log("Posted to Facebook:", fbRes);
      postedSet.add(id);
      postedThisRun += 1;
      // small pause
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      console.error("Failed to publish to Facebook for item:", id);
    }

    // safety limit per run (تعديل مقبول): هنا نحدها الى 3 منشورات لكل تشغيل
    if (postedThisRun >= 3) {
      console.log("Posted 3 items this run — stopping to avoid over-posting.");
      break;
    }
  }

  // save posted list
  savePosted({ posted: Array.from(postedSet) });
  console.log("Done. Total posted count:", postedSet.size);
})();
