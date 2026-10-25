import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { requireUser } from "../auth/session.js";
import {
  listAddressesForUser,
  createAddress,
  updateAddress,
  deleteAddress,
  type AddressInput,
} from "../addresses/addressRepo.js";

const addressProperties = {
  label: { type: "string" },
  fullName: { type: "string", minLength: 1 },
  phone: { type: "string", minLength: 1 },
  line1: { type: "string", minLength: 1 },
  line2: { type: "string" },
  city: { type: "string", minLength: 1 },
  state: { type: "string" },
  country: { type: "string" },
  postalCode: { type: "string", minLength: 5 },
  isDefault: { type: "boolean" },
} as const;

/**
 * Account-only saved addresses (a guest's shipping address for one order is
 * a plain `addresses` row created directly at checkout, not through here —
 * that lands with Stage 8's checkout flow, not this CRUD surface).
 * Every query is scoped to the signed-in user's own id, at the data layer,
 * so there's no id-guessing path onto someone else's address.
 */
export const addressRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/addresses", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const addresses = await listAddressesForUser(user.id);
    return reply.send({ addresses });
  });

  app.post(
    "/addresses",
    {
      schema: {
        body: {
          type: "object",
          required: ["fullName", "phone", "line1", "city", "postalCode"],
          properties: addressProperties,
        },
      },
    },
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;

      const address = await createAddress(user.id, req.body as AddressInput);
      return reply.status(201).send({ address });
    },
  );

  app.patch(
    "/addresses/:id",
    { schema: { body: { type: "object", properties: addressProperties } } },
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;

      const { id } = req.params as { id: string };
      const updated = await updateAddress(user.id, id, req.body as Partial<AddressInput>);

      if (!updated) return reply.status(404).send({ error: "Address not found." });
      return reply.send({ address: updated });
    },
  );

  app.delete("/addresses/:id", async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;

    const { id } = req.params as { id: string };
    const deleted = await deleteAddress(user.id, id);

    if (!deleted) return reply.status(404).send({ error: "Address not found." });
    return reply.send({ ok: true });
  });
};
