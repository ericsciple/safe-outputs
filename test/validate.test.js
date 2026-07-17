import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "../src/validate.js";

const labelsSchema = {
  type: "object",
  required: ["labels"],
  additionalProperties: false,
  properties: {
    labels: { type: "array", minItems: 1, items: { type: "string" } },
  },
};

test("valid labels payload passes", () => {
  assert.deepEqual(validate(labelsSchema, { labels: ["bug"] }), []);
});

test("missing required field is reported", () => {
  const errors = validate(labelsSchema, {});
  assert.equal(errors.length, 1);
  assert.match(errors[0], /labels: is required/);
});

test("unexpected property is reported", () => {
  const errors = validate(labelsSchema, { labels: ["bug"], issue_number: 5 });
  assert.ok(errors.some((e) => /issue_number: is not an allowed property/.test(e)));
});

test("wrong item type is reported", () => {
  const errors = validate(labelsSchema, { labels: [1, "ok"] });
  assert.ok(errors.some((e) => /labels\[0\]: expected string, got number/.test(e)));
});

test("minItems is enforced", () => {
  const errors = validate(labelsSchema, { labels: [] });
  assert.ok(errors.some((e) => /at least 1 item/.test(e)));
});

test("wrong base type short-circuits", () => {
  const errors = validate(labelsSchema, "nope");
  assert.equal(errors.length, 1);
  assert.match(errors[0], /expected object, got string/);
});

test("minLength on string is enforced", () => {
  const bodySchema = {
    type: "object",
    required: ["body"],
    additionalProperties: false,
    properties: { body: { type: "string", minLength: 1 } },
  };
  assert.deepEqual(validate(bodySchema, { body: "hi" }), []);
  const errors = validate(bodySchema, { body: "" });
  assert.ok(errors.some((e) => /at least 1 character/.test(e)));
});

test("enum is enforced", () => {
  const schema = { enum: ["a", "b"] };
  assert.deepEqual(validate(schema, "a"), []);
  assert.ok(validate(schema, "c").some((e) => /must be one of/.test(e)));
});
