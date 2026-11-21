import { createContext, useContext, type ReactNode } from "react";
import { findTopic, topicPath } from "../handbook";
import type { TopicRef } from "./terms";

/** Rollen der angemeldeten Person, damit Verweise ins Handbuch nur zu sichtbaren Themen führen. */
const HelpRoles = createContext<readonly string[]>([]);

export function HelpProvider({
  roles,
  children,
}: {
  roles: readonly string[];
  children: ReactNode;
}) {
  return <HelpRoles.Provider value={roles}>{children}</HelpRoles.Provider>;
}

/** Adresse des ersten Themas, das die Rollen sehen dürfen, sonst null. */
export function topicLink(topics: readonly TopicRef[], roles: readonly string[]): string | null {
  for (const [area, topic] of topics) {
    if (findTopic(roles, area, topic)) {
      return topicPath(area, topic);
    }
  }
  return null;
}

/** Wie `topicLink`, mit den Rollen der angemeldeten Person. */
export function useTopicLink(topics: readonly TopicRef[]): string | null {
  return topicLink(topics, useContext(HelpRoles));
}
