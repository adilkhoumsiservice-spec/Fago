// scripts/fetch_and_publish.js

import Parser from "rss-parser";
import fetch from "node-fetch";

const rssUrl = "https://feeds.bbci.co.uk/news/rss.xml";
const huggingFaceApiKey = process.env.HF_API_KEY;
const facebookPageAccessToken = process.env.FB_PAGE_TOKEN;
const facebookPageId = process.env.FB_PAGE_ID;

const parser = new Parser();

async function summarizeText(text) {
  const response = await fetch(
    "https://api-inference.huggingface.co/models/facebook/bart-large-cnn",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${huggingFaceApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: text }),
    }
  );

  const data = await response.json();
  if (Array.isArray(data) && data[0]?.summary_text) {
    return data[0].summary_text;
  }
  console.error("Summarization failed:", data);
  return text;
}

async function postToFacebook(message) {
  const url = `https://graph.facebook.com/${facebookPageId}/feed?message=${encodeURIComponent(
    message
  )}&access_token=${facebookPageAccessToken}`;

  const res = await fetch(url, { method: "POST" });
  const data = await res.json();

  if (data.error) {
    console.error("Facebook post error:", data.error);
  } else {
    console.log("Posted to Facebook:", data);
  }
}

async function fetchAndPublish() {
  const feed = await parser.parseURL(rssUrl);

  for (const item of feed.items.slice(0, 3)) {
    const summary = await summarizeText(item.contentSnippet || item.title);
    const message = `${item.title}\n\n${summary}\n\nRead more: ${item.link}`;
    await postToFacebook(message);
  }
}

fetchAndPublish();
