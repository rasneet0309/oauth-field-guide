/**
 * Knowledge the generator uses for apps outside the library: product-name aliases,
 * vendor platform families and category keywords. Carried over from v2's guide builder.
 * Pure and isomorphic.
 */
import { norm } from "./text.js";

/** Normalised product name → library id. "Gmail" opens the Google Workspace guide. */
export const ALIASES = Object.freeze({
  gmail: "google-workspace",
  googledrive: "google-workspace",
  googledocs: "google-workspace",
  googlesheets: "google-workspace",
  googlecalendar: "google-workspace",
  googlemeet: "google-workspace",
  googleforms: "google-workspace",
  googleslides: "google-workspace",
  googlechat: "google-workspace",
  gsuite: "google-workspace",
  google: "google-workspace",
  googleworkspace: "google-workspace",
  outlook: "microsoft-365",
  office365: "microsoft-365",
  microsoft365: "microsoft-365",
  onedrive: "microsoft-365",
  sharepoint: "microsoft-365",
  microsoftteams: "microsoft-365",
  msteams: "microsoft-365",
  teams: "microsoft-365",
  excel: "microsoft-365",
  onenote: "microsoft-365",
  microsoftgraph: "microsoft-365",
  entraid: "microsoft-365",
  azuread: "microsoft-365",
  microsoft: "microsoft-365",
  outlookcom: "microsoft-365",
  facebook: "meta",
  instagram: "meta",
  messenger: "meta",
  facebookpages: "meta",
  instagrambusiness: "meta",
  metabusiness: "meta",
  whatsapp: "whatsapp-business",
  whatsappbusinessapi: "whatsapp-business",
  whatsappcloudapi: "whatsapp-business",
  whatsappbusinessplatform: "whatsapp-business",
  facebookads: "meta-ads",
  instagramads: "meta-ads",
  metaads: "meta-ads",
  metamarketingapi: "meta-ads",
  facebookmarketingapi: "meta-ads",
  googleadsapi: "google-ads",
  linkedinmarketing: "linkedin-ads",
  linkedinmarketingapi: "linkedin-ads",
  microsoftoutlook: "microsoft-365",
  microsoftgraphapi: "microsoft-365",
  jirasoftware: "jira",
  atlassianjira: "jira",
  slackenterprisegrid: "slack",
  githubenterprise: "github",
  hubspotcrm: "hubspot",
  shopifyplus: "shopify",
  quickbooksonline: "quickbooks",
  intuitquickbooks: "quickbooks",
  salesforcecrm: "salesforce",
  sfdc: "salesforce",
  zohocrmplus: "zoho-crm",
});

/** Library id for a query that is a known alias, else null. */
export function aliasFor(query) {
  const key = norm(query);
  return Object.hasOwn(ALIASES, key) ? ALIASES[key] : null;
}

/**
 * Products that share a researched vendor's developer platform. `oauth`/`review` are the
 * builder answers implied by the platform; `rel` is the researched library app; `vendor` owns
 * the developer platform, so it is the one that reviews and approves apps (Atlassian, not
 * Confluence; Microsoft, not Power BI).
 */
export const FAMILIES = Object.freeze([
  {
    match: /^zoho/,
    domain: "zoho.com",
    vendor: "Zoho",
    rel: "zoho-crm",
    oauth: "self",
    review: "listing",
    note: "Zoho products share one developer platform. Register a Server-based client in the Zoho API Console (api-console.zoho.com), the same place as Zoho CRM. Turn on multi-data-center support so customers in EU, IN, AU and other regions work, and use the API domain returned with each token. Scopes are product-specific.",
  },
  {
    match: /^(confluence|jiraservicemanagement|jsm|compass|atlassian)/,
    domain: "atlassian.com",
    vendor: "Atlassian",
    rel: "jira",
    oauth: "self",
    review: "listing",
    note: "Confluence and other Atlassian cloud products use the same Atlassian developer console as Jira. Create an OAuth 2.0 (3LO) app, add the product's scopes, then turn on Distribution → Sharing. Users see an “unreviewed app” warning unless you list it on the Atlassian Marketplace.",
  },
  {
    match:
      /^(youtube|googleanalytics|searchconsole|googlesearchconsole|googlebusinessprofile|googlemybusiness|googletasks|googlecontacts|googlekeep|googlephotos|bigquery)/,
    domain: "google.com",
    vendor: "Google",
    rel: "google-workspace",
    oauth: "self",
    review: "yes",
    note: "This Google API uses the same Google Cloud project, Google Auth Platform consent screen and verification as Gmail and Drive. Review takes days or months depending on the scope tier: non-sensitive, sensitive or restricted.",
  },
  {
    match:
      /^(dynamics|dynamics365|powerbi|azuredevops|microsoftplanner|planner|microsofttodo|microsoftbookings|bookings)/,
    domain: "microsoft.com",
    vendor: "Microsoft",
    rel: "microsoft-365",
    oauth: "self",
    review: "yes",
    note: "Register this in Microsoft Entra like any Microsoft 365 app, then request this product's API permissions. Publisher verification and customer admin consent work the same as for Graph.",
  },
  {
    match: /^(pardot|accountengagement|salesforcemarketingcloud|marketingcloud)/,
    domain: "salesforce.com",
    vendor: "Salesforce",
    rel: "salesforce",
    oauth: "self",
    review: "listing",
    note: "This Salesforce product authenticates through Salesforce OAuth: an External Client App, distributed in a package that each customer's admin installs.",
  },
  {
    match: /^(quickbookstime|quickbookspayroll|tsheets)/,
    domain: "intuit.com",
    vendor: "Intuit",
    rel: "quickbooks",
    oauth: "self",
    review: "yes",
    note: "This uses the same Intuit developer account and app as QuickBooks Online, including the assessment for production keys.",
  },
  {
    // Facebook Ads, Instagram Ads and WhatsApp Business are library apps (aliases above);
    // this family covers Meta's other products.
    match: /^(facebook|instagram|messenger|metagraph|metaplatform|metabusinesssuite|workplacefrommeta)/,
    domain: "facebook.com",
    vendor: "Meta",
    rel: "meta",
    oauth: "self",
    review: "yes",
    note: "This runs on Meta's developer platform: Business Verification, App Review for each permission, and a yearly Data Access Renewal.",
  },
]);

/** Vendor family for a product name or website, or null. */
export function familyFor(name, website) {
  const n = norm(name);
  const w = norm(website);
  return FAMILIES.find((f) => f.match.test(n) || (w && f.match.test(w))) || null;
}

/** Keyword patterns used to guess the category of an unknown app. First match wins. */
export const CATEGORY_KEYWORDS = Object.freeze([
  ["CRM & Sales", /crm|sales|deal|lead|prospect|pipeline|outreach|apollo|gong|salesloft|freshsales/],
  ["Support & Helpdesk", /desk|support|help|ticket|kustomer|servicenow/],
  ["Communications & Messaging", /chat|messag|\bsms\b|voice|call|phone|meet|zoom|webex|teams|signal|wechat/],
  [
    "Marketing, Ads, Email & Social",
    /ads|mail|newsletter|social|tiktok|twitter|linkedin|reddit|youtube|seo|marketing|campaign|buffer|hootsuite|canva|typeform|survey/,
  ],
  ["Ecommerce", /shop|store|commerce|cart|etsy|ebay|amazon|woo|checkout|inventory/],
  ["Data, SEO & Scraping", /scrap|crawl|data|enrich|seo|serp|proxy|warehouse|analytics/],
  [
    "Developer, Infra & Data",
    /git|deploy|cloud|database|\bdb\b|monitor|logging|\bci\b|devops|kubernetes|\baws\b|azure|heroku|docker|postgres|redis|vercel/,
  ],
  [
    "Productivity & PM",
    /task|project|todo|doc|note|calendar|calendly|schedul|board|form|sheet|wiki|drive|dropbox|box|file|sign|trello|basecamp|miro|figma|loom/,
  ],
  [
    "Finance & Fintech",
    /pay|bank|invoice|account|finance|expense|payroll|tax|card|crypto|wallet|books|billing|ledger|gusto|rippling|bill/,
  ],
  ["AI, Research & Media", /\bai\b|\.ai\b|gpt|llm|transcri|meeting ?notes|video|podcast|research|image|audio/],
]);

/**
 * The category whose keywords appear in the name or domain, or null when none do. There is
 * no default: a category picked for want of a better one isn't evidence about the app.
 * Callers pass the registrable domain, not a URL: a path or subdomain describes a page.
 */
export function guessCategory(categories, name, domain) {
  const s = `${name ?? ""} ${domain ?? ""}`.toLowerCase();
  const hit = CATEGORY_KEYWORDS.find(([, re]) => re.test(s));
  return hit && categories.includes(hit[0]) ? hit[0] : null;
}
