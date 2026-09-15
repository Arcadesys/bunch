import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { catchUpWidget } from "@/server/companion-widget";

function widgetHarness() {
  const html = catchUpWidget("https://system-arcades-me.vercel.app");
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  assert.ok(script);
  const elements = new Map<string, { innerHTML: string; textContent: string }>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { innerHTML: "", textContent: "" });
    return elements.get(id)!;
  };
  let messageHandler: (event: unknown) => void = () => {};
  const sent: Array<{ id: number }> = [];
  const parent = { postMessage: (message: { id: number }) => sent.push(message) };
  const context = vm.createContext({
    parent,
    crypto: { randomUUID: () => "test-request" },
    document: { getElementById: element, querySelectorAll: () => [] },
    window: { openai: { toolOutput: { catchUp: null } }, parent, addEventListener: (_name: string, handler: (event: unknown) => void) => { messageHandler = handler; } },
    Intl,
  });
  vm.runInContext(script, context);
  return { html, element, context, sent, deliver: (data: unknown) => messageHandler({ source: parent, data }) };
}

test("catch-up widget derives its identity from the record and does not infer absence", () => {
  const { context, element } = widgetHarness();
  vm.runInContext(`render({alterName:'Example Person',firstTime:false,windowStart:'2026-09-01T12:00:00Z',windowEnd:'2026-09-04T12:00:00Z',items:[],totalCount:0,reviewedCount:0})`, context);
  assert.equal(element("avatar").textContent, "EP");
  assert.equal(element("welcome").textContent, "Catch-up for Example Person");
  assert.match(element("front").innerHTML, /Catch-up window:/);
  assert.doesNotMatch(element("front").innerHTML, /Away|returned|stepped away/);
  vm.runInContext("render(null)", context);
  assert.equal(element("avatar").textContent, "?");
  assert.doesNotMatch(element("front").innerHTML, /No current front is recorded/);
});

test("widget keeps review actions distinct from task completion and labels catch-up filters", () => {
  const { html, context } = widgetHarness();
  assert.match(html, /Catch-up tasks/);
  assert.match(html, /Catch-up notes/);
  assert.match(html, /Review actions do not complete tasks/);
  const card = vm.runInContext(`itemCard({entryId:'example',itemType:'TODO',title:'A saved task',fromLabel:'System',toLabel:'System',timestamp:'2026-09-01T12:00:00Z',whyItMatters:'Context',nextAction:'Read it',reviewState:'ACKNOWLEDGED',version:1})`, context);
  assert.match(card, /class="state">Reviewed</);
  assert.match(card, /data-action="ACKNOWLEDGED"[^>]*>Mark reviewed/);
  assert.doesNotMatch(card, /data-action="RESOLVED"/);
  assert.equal(vm.runInContext("reviewLabel('RESOLVED')", context), "Review finished");
  assert.doesNotMatch(card, />Resolve<|>ACKNOWLEDGED</);
});

for (const transport of ["openai", "postMessage"]) {
  test(`widget preserves catch-up when ${transport} returns an MCP tool error`, async () => {
    const { context, element, sent, deliver } = widgetHarness();
    vm.runInContext(`render({alterName:'Example',firstTime:true,items:[],totalCount:0,reviewedCount:0})`, context);
    const before = element("items").innerHTML;
    const errorResult = { isError: true, content: [{ type: "text", text: "Conflict: reload before reviewing." }] };
    if (transport === "openai") {
      context.errorResult = errorResult;
      vm.runInContext("window.openai.callTool = async () => errorResult", context);
    }
    const update = vm.runInContext("update({dataset:{entry:'entry'}},{dataset:{action:'ACKNOWLEDGED',version:'1'}})", context);
    if (transport === "postMessage") deliver({ id: sent[0].id, result: errorResult });
    await update;
    assert.equal(element("items").innerHTML, before);
    assert.equal(element("welcome").textContent, "Catch-up for Example");
    assert.equal(element("notice").textContent, "Conflict: reload before reviewing.");
    deliver({ method: "ui/notifications/tool-result", params: errorResult });
    assert.equal(element("welcome").textContent, "Catch-up for Example");
  });
}

test("widget offers current fronting episodes without treating hosting as fronting", () => {
  const {context,element}=widgetHarness();
  vm.runInContext(`render({structuredContent:{presence:{hosting:{id:'host-period',alterName:'Example',kind:'HOSTING'},fronting:[{id:'front-period',alterName:'Example',kind:'FRONTING'}]},catchUp:null}})`,context);
  assert.doesNotMatch(element("period-choice").innerHTML,/Example · hosting/);
  assert.match(element("period-choice").innerHTML,/Example · fronting/);
  assert.equal(element("welcome").textContent,"Your catch-up");
  assert.match(element("items").innerHTML,/choose a catch-up period/);
});
