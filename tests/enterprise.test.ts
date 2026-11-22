import assert from 'node:assert/strict'
import { test } from 'node:test'
import { InvalidEnterpriseUrlError, deviceFlowUrls, normalizeEnterpriseDomain } from '../src/host/enterprise.ts'

test('normalizes a GitHub Enterprise URL or bare host to its hostname', () => {
  assert.equal(normalizeEnterpriseDomain('https://octocorp.ghe.com/'), 'octocorp.ghe.com')
  assert.equal(normalizeEnterpriseDomain('  octocorp.ghe.com  '), 'octocorp.ghe.com')
  assert.equal(normalizeEnterpriseDomain('https://OctoCorp.GHE.com/login/device'), 'octocorp.ghe.com')
})

test('blank and github.com mean no enterprise host', () => {
  for (const value of [undefined, '', '   ', 'github.com', 'https://github.com/', 'www.github.com']) {
    assert.equal(normalizeEnterpriseDomain(value), undefined, String(value))
  }
})

test('rejects values that are not a URL or host', () => {
  for (const value of ['https://', 'ftp://octocorp.ghe.com', 'not a host']) {
    assert.throws(() => normalizeEnterpriseDomain(value), InvalidEnterpriseUrlError, value)
  }
})

test('derives the device-flow endpoints from the host', () => {
  assert.deepEqual(deviceFlowUrls('octocorp.ghe.com'), {
    deviceCodeUrl: 'https://octocorp.ghe.com/login/device/code',
    accessTokenUrl: 'https://octocorp.ghe.com/login/oauth/access_token',
    verificationUri: 'https://octocorp.ghe.com/login/device',
  })
})
