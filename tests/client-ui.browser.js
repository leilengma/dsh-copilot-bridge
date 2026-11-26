// Run with the isolated server from scripts/serve-client-ui-fixture.mjs open in a
// task-owned Tabbit page: tabbit-cli nodejs --task <task> < tests/client-ui.browser.js
// Tabbit supplies page/expect. This tests production React state, not the desktop shell.
await page.reload({ waitUntil: 'domcontentloaded' })
const passed = []
const same = (actual, expected, message) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${message}: ${JSON.stringify(actual)}`)
}
const order = () => page.locator('tbody tr').evaluateAll(rows => rows.map(row => row.children[1].textContent))
const ready = async () => { await expect(page.getByRole('table')).toHaveAttribute('aria-busy', 'false') }
await ready()
same(await order(), ['Alphaalpha', 'Betabeta', 'Gammagamma', 'DisableddisabledNot offered for selection'], 'default catalog order')
const adjacency = await page.getByRole('button', { name: 'Pin model Beta', exact: true }).evaluate(button => {
  const eye = button.previousElementSibling
  const a = eye.getBoundingClientRect(), b = button.getBoundingClientRect()
  return { eye: eye.getAttribute('aria-label'), sameCell: eye.closest('td') === button.closest('td'), sameLine: a.y === b.y, gap: b.x - a.right, width: b.width, height: b.height }
})
same(adjacency, { eye: 'Show Beta', sameCell: true, sameLine: true, gap: 4, width: 36, height: 36 }, 'adjacent equal hit areas')
await expect(page.getByRole('button', { name: /(?:Pin|Unpin).*Disabled/ })).toHaveCount(0)
passed.push('adjacent 36px actions, 4px gap; disabled models have no pin')

await page.evaluate(() => window.modelUiFixture.holdNextSave())
const betaPin = page.getByRole('button', { name: 'Pin model Beta', exact: true })
await betaPin.focus()
await betaPin.press('Enter')
await expect(page.getByRole('table')).toHaveAttribute('aria-busy', 'true')
await expect(betaPin).toHaveAttribute('aria-pressed', 'false')
same(await page.locator('tbody button:disabled').count(), 6, 'all visibility/pin mutations disabled during save')
same(await page.evaluate(() => window.modelUiFixture.calls.filter(call => call.path.endsWith('/pinned-models')).map(call => call.body)), [{ pinnedModels: ['beta'] }], 'keyboard activation posts one exact ID')
await page.evaluate(() => window.modelUiFixture.releaseSave())
await expect(page.getByRole('button', { name: 'Unpin model Beta', exact: true })).toHaveAttribute('aria-pressed', 'true')
await ready()
same(await order(), ['Betabeta', 'Alphaalpha', 'Gammagamma', 'DisableddisabledNot offered for selection'], 'hidden pin sorts first')
await expect(page.getByRole('button', { name: 'Show Beta', exact: true })).toHaveAttribute('aria-pressed', 'false')
passed.push('keyboard Pin, pending serialization, confirmed pin ordering without reveal')

await page.evaluate(() => window.modelUiFixture.failNextSave())
await page.getByRole('button', { name: 'Unpin model Beta', exact: true }).click()
await expect(page.getByRole('alert')).toHaveText('Fixture settings unavailable')
await ready()
await expect(page.getByRole('button', { name: 'Unpin model Beta', exact: true })).toHaveAttribute('aria-pressed', 'true')
await page.getByRole('button', { name: 'Unpin model Beta', exact: true }).click()
await expect(page.getByRole('button', { name: 'Pin model Beta', exact: true })).toHaveAttribute('aria-pressed', 'false')
await ready()
await expect(page.getByRole('alert')).toHaveCount(0)
same(await order(), ['Alphaalpha', 'Betabeta', 'Gammagamma', 'DisableddisabledNot offered for selection'], 'unpin restores catalog order')
await expect(page.getByRole('button', { name: 'Show Beta', exact: true })).toHaveAttribute('aria-pressed', 'false')
passed.push('failed Unpin retains confirmed state; same-action retry restores order without revealing')

await page.evaluate(() => window.modelUiFixture.notifyDuringSave())
await page.getByRole('button', { name: 'Pin model Gamma', exact: true }).click()
await expect(page.getByRole('button', { name: 'Unpin model Gamma', exact: true })).toHaveAttribute('aria-pressed', 'true')
await ready()
await page.getByRole('button', { name: 'Pin model Alpha', exact: true }).click()
await expect(page.getByRole('button', { name: 'Unpin model Alpha', exact: true })).toHaveAttribute('aria-pressed', 'true')
await ready()
same(await order(), ['Alphaalpha', 'Gammagamma', 'Betabeta', 'DisableddisabledNot offered for selection'], 'pins retain catalog order, not click order')
await page.getByRole('searchbox', { name: 'Filter models' }).fill('BETA')
same(await order(), ['Betabeta'], 'case-insensitive filter unchanged')
await page.getByRole('searchbox', { name: 'Filter models' }).fill('')
passed.push('forwarded store revision during save re-reads confirmed status; stable ordering and filter')

await page.evaluate(() => window.modelUiFixture.setWritable(false))
await ready()
await expect(page.getByRole('button', { name: 'Unpin model Alpha', exact: true })).toBeDisabled()
same(await page.locator('tbody button:disabled').count(), 6, 'read-only model mutations disabled')
await page.getByRole('searchbox', { name: 'Filter models' }).fill('gamma')
same(await order(), ['Gammagamma'], 'read-only search works')
await page.getByRole('searchbox', { name: 'Filter models' }).fill('')
await page.evaluate(() => { window.modelUiFixture.setWritable(true); window.modelUiFixture.setLocale('zh') })
await ready()
await expect(page.getByRole('button', { name: '取消置顶模型 Alpha', exact: true })).toBeEnabled()
await page.getByRole('button', { name: '取消置顶模型 Alpha', exact: true }).press('Space')
await expect(page.getByRole('button', { name: '置顶模型 Alpha', exact: true })).toHaveAttribute('aria-pressed', 'false')
await ready()
await expect(page.getByRole('button', { name: '显示 Beta', exact: true })).toHaveAttribute('aria-pressed', 'false')
await page.evaluate(() => window.modelUiFixture.setLocale('en'))
passed.push('read-only disables pin/eye but not search; Chinese labels and Space-to-Unpin')
return { passed }
