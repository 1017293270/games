import { z } from 'zod';
import { ART_IDS } from '../core/art.js';
import { ConditionSchema, EffectSchema } from './script.js';

const ArtIdSchema = z.enum(ART_IDS);

/** Roles drive which panels the client offers on the NPC screen. */
export const NPC_ROLES = [
  'sect_master',
  'elder',
  'alchemist',
  'merchant',
  'hermit',
  'blacksmith',
  'arena_host',
  'guard',
] as const;
export const NpcRoleSchema = z.enum(NPC_ROLES);
export type NpcRole = z.infer<typeof NpcRoleSchema>;

export const NpcSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  art: ArtIdSchema,
  role: NpcRoleSchema,
  /** Where the NPC stands; all launch NPCs are in 青云镇. */
  location: z.string().min(1),
  /** Shop opened from this NPC, if any. */
  shopId: z.string().min(1).nullable(),
  /** Root dialogue tree id. */
  dialogueId: z.string().min(1),
  /** Quests this NPC can hand out. */
  questIds: z.array(z.string().min(1)),
  unlockStage: z.number().int().min(0).max(35),
});
export type Npc = z.infer<typeof NpcSchema>;

export const DialogueChoiceSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  /** All must hold for the choice to be selectable. */
  conditions: z.array(ConditionSchema).default([]),
  /** Applied in order when the choice is taken. */
  effects: z.array(EffectSchema).default([]),
  /** Next node id; null ends the conversation. */
  next: z.string().min(1).nullable(),
  /** When true the client hides rather than greys out a blocked choice. */
  hideWhenBlocked: z.boolean().default(false),
});
export type DialogueChoice = z.infer<typeof DialogueChoiceSchema>;

export const DialogueNodeSchema = z.object({
  id: z.string().min(1),
  /** Spoken line. Empty string means a silent branch node. */
  text: z.string(),
  /** Overrides the NPC portrait for this node. */
  art: ArtIdSchema.nullable().default(null),
  /** Applied on entering the node, before choices are shown. */
  onEnter: z.array(EffectSchema).default([]),
  choices: z.array(DialogueChoiceSchema),
});
export type DialogueNode = z.infer<typeof DialogueNodeSchema>;

export const DialogueTreeSchema = z.object({
  id: z.string().min(1),
  npcId: z.string().min(1),
  /** Node the conversation opens on. */
  rootNodeId: z.string().min(1),
  nodes: z.array(DialogueNodeSchema).min(1),
});
export type DialogueTree = z.infer<typeof DialogueTreeSchema>;
