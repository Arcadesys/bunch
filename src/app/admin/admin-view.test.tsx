import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AdminView } from "./admin-view";

test("admin view has a clear heading, navigation, and labeled controls", () => {
  const html = renderToStaticMarkup(<AdminView />);

  assert.match(html, /<main class="shell">/);
  assert.match(html, /<nav aria-label="Admin navigation">/);
  assert.match(html, /<h1>Admin<\/h1>/);
  assert.match(html, /aria-labelledby="account-controls-heading"/);
  assert.match(html, />Manage invitations<\/a>/);
  assert.match(html, />Manage image allowances<\/a>/);
  assert.match(html, /AI image spend/);
  assert.match(html, /Cost per active user-day/);
  assert.match(html, /Thirty-day spend by model and quality/);
});
