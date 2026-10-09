import { test, expect } from "./fixtures";

for (const route of ["board", "board-list", "notes"]) {
  test(`${route} preserves readable layout and controls with enlarged text`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(route === "board" ? "/board?view=board" : route === "board-list" ? "/board" : `/${route}`);
    // The list views (Todos default view, Notes) open their editors from the list's new-record action.
    if (route === "notes") await page.getByRole("button", { name: "+ Leave a note" }).click();
    if (route === "board-list") await page.getByRole("button", { name: "+ Add a todo" }).click();
    await expect(page.getByRole("button", { name: route === "notes" ? "Save note" : "Save todo", exact: true })).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; document.documentElement.style.fontSize = "40px"; }, theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const controls = page.locator('main button:visible, main select:visible, main textarea:visible, main input:visible');
      const tooSmall = await controls.evaluateAll(elements => elements.flatMap(element => {
        const target = element instanceof HTMLInputElement && element.type === "checkbox" ? element.closest("label") ?? element : element;
        const rect = target.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44 ? [{ tag: element.tagName, width: rect.width, height: rect.height }] : [];
      }));
      expect(tooSmall).toEqual([]);
      if (info.project.name === "desktop") {
        await page.evaluate(() => { document.documentElement.style.fontSize = "20px"; window.scrollTo(0, 0); });
        await page.screenshot({ path: info.outputPath(`${route}-${theme}-preview.png`), fullPage: false });
      }
    }
    expect(errors).toEqual([]);
  });
}
