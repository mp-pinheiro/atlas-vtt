/** The host key of the test relay: a constant for tests only, bound as `HOST_KEY` by `vitest.config.ts`. It protects nothing. */
export const TEST_HOST_KEY = 'test-only-host-key-0123456789abcdef';

/** Another key of the protocol's secret form, for the tests that change the relay's key or make a second host. */
export const OTHER_HOST_KEY = 'other-test-host-key-fedcba9876543210';
