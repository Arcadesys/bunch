import { test, expect } from '@playwright/test';

test('character visual anchors enter the local packet and reset without sending character data', async ({ page }) => {
  const apiRequests: Array<{path:string;method:string;body:string|null}> = [];
  page.on('request', request => { const path=new URL(request.url()).pathname; if (path.startsWith('/api/')) apiRequests.push({path,method:request.method(),body:request.postData()}); });
  await page.goto('/characters');
  const appearance = page.getByLabel('Appearance and visual anchors');
  await appearance.fill('White fur, purple glasses, permanent left-ear notch.');
  const packet = page.locator('pre');
  await expect(packet).toContainText('## Visual identity\nWhite fur, purple glasses, permanent left-ear notch.');
  await expect(packet).toContainText('If no image is attached, do not claim to have seen one.');
  await page.getByRole('button', {name:'Reset example'}).click();
  await expect(appearance).toHaveValue('');
  for (const request of apiRequests) expect(request).toEqual({path:'/api/v1/preferences/appearance',method:'GET',body:null});
});

test('character helper retains keyboard access and enlarged-text reflow', async ({page}) => {
  await page.goto('/characters');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link',{name:'Skip to helper'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#helper$/);
  await page.evaluate(()=>{document.documentElement.style.fontSize='40px';});
  await expect(page.getByLabel('Appearance and visual anchors')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
