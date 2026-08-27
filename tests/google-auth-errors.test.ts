import assert from "node:assert/strict";
import test from "node:test";
import {
  GOOGLE_REAUTH_REQUIRED,
  GoogleReauthorizationRequiredError,
  isGoogleReauthorizationFailure,
  isGoogleReauthorizationRequiredError,
  messageNeedsGoogleReauthorization,
} from "../lib/google/auth-errors";

test("recognizes explicit reconnect errors", () => {
  const error = new GoogleReauthorizationRequiredError();
  assert.equal(error.code, GOOGLE_REAUTH_REQUIRED);
  assert.equal(isGoogleReauthorizationRequiredError(error), true);
  assert.equal(messageNeedsGoogleReauthorization(error.message), true);
});

test("recognizes revoked and expired OAuth credential failures", () => {
  assert.equal(isGoogleReauthorizationFailure({ code: "invalid_grant" }), true);
  assert.equal(isGoogleReauthorizationFailure({ response: { status: 401 } }), true);
  assert.equal(isGoogleReauthorizationFailure({ message: "Token has been expired or revoked" }), true);
  assert.equal(isGoogleReauthorizationFailure({ response: { data: { error: "invalid_token" } } }), true);
});

test("does not confuse transient or permission errors with reauthorization", () => {
  assert.equal(isGoogleReauthorizationFailure({ response: { status: 429 } }), false);
  assert.equal(isGoogleReauthorizationFailure({ response: { status: 403 } }), false);
  assert.equal(isGoogleReauthorizationFailure({ code: "ECONNRESET" }), false);
  assert.equal(messageNeedsGoogleReauthorization("You do not have permission to add files to this folder"), false);
});
