"use client";

import { createContext, useContext } from "react";

export type AdminRole = "Owner" | "Manager" | "Support" | "Packer";
export interface AdminMe { id: string; email: string; name: string; role: AdminRole }

/** The signed-in team member and the admin areas their role may open (from the server). */
export const AdminContext = createContext<{ admin: AdminMe | null; areas: string[] }>({ admin: null, areas: [] });
export const useAdmin = () => useContext(AdminContext);

/** Mirrors the server's permission table for buttons; the server still checks every action. */
export function canEdit(role: AdminRole | undefined, what: "products" | "stock"): boolean {
  if (!role) return false;
  if (role === "Owner" || role === "Manager") return true;
  return what === "stock" && role === "Packer";
}
