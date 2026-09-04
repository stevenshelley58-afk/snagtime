import { signBlockwisePayload } from "@/server/services/blockwise-events";

export function blockwiseDeliveryRequest(payloadJson: string, eventId: string, timestamp = Math.floor(Date.now() / 1000), signature = signBlockwisePayload(payloadJson, timestamp)) {
  return { method: "POST", headers: {
    "content-type": "application/json", "x-snagtime-timestamp": String(timestamp),
    "x-snagtime-event-id": eventId,
    "x-snagtime-signature": `sha256=${signature}`,
  }, body: payloadJson } as const;
}
