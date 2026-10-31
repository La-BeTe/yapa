// `testTimeout` is a global-only Jest option, so the e2e project sets its own here:
// booting the app against real containers takes longer than the 5s default.
jest.setTimeout(60_000);
