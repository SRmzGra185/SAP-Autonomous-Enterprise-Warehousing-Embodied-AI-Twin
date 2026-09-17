import { HttpError } from "../http-utils.mjs";
export const rackStates = ["available", "empty", "blocked", "replenishment_delayed"];
export const defaultCaseContext = Object.freeze({ sku: "DEMO-PUMP-KIT", rfidEpc: "3034257BF400B78000000001", quantity: 4, destination: "DEMO-RECEIVING-01", rackState: "available" });
export function validateCaseContext(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(defaultCaseContext, key))) throw new HttpError(400, "Case context contains unsupported fields.", "validation_error");
  const context = { ...defaultCaseContext, ...value };
  for (const key of ["sku", "destination"]) if (typeof context[key] !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(context[key])) throw new HttpError(400, key + " must be a bounded business identifier.", "validation_error");
  if (typeof context.rfidEpc !== "string" || !/^[A-Fa-f0-9]{8,64}$/.test(context.rfidEpc)) throw new HttpError(400, "RFID EPC must be 8–64 hexadecimal characters for this demo.", "validation_error");
  if (!Number.isInteger(context.quantity) || context.quantity < 1 || context.quantity > 10000) throw new HttpError(400, "Quantity must be an integer 1–10000.", "validation_error");
  if (!rackStates.includes(context.rackState)) throw new HttpError(400, "Unknown shelf state.", "validation_error");
  return { ...context, rfidEpc: context.rfidEpc.toUpperCase() };
}
