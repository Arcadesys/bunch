import { test, expect } from './fixtures';

test('drag a task by its title into an empty column', async ({ page, harness }, info) => {
  test.skip(info.project.name !== 'desktop');
  await page.goto('/board');
  const task = page.getByRole('article').filter({ hasText: 'Fixture todo' });
  const title = task.getByRole('heading', { name: 'Fixture todo' });
  const target = page.getByRole('heading', { name: 'Doing' });
  await title.scrollIntoViewIfNeeded();
  const a = await title.boundingBox();
  const b = await target.boundingBox();
  await page.mouse.move(a!.x + 20, a!.y + 10);
  await page.mouse.down();
  await page.mouse.move(b!.x + 30, b!.y + 60, { steps: 20 });
  await page.mouse.up();
  await expect(target.locator('..')).toContainText('Fixture todo');
  expect(harness.saved.todos[0].status).toBe('IN_PROGRESS');
});
