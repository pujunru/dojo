"use client";

import * as React from "react";
import { BookOpen, Check, Code2, Laptop, Lock, Play, RotateCcw, Trophy } from "lucide-react";
import { useTranslations } from "use-intl";
import { Button } from "../ui/button";
import { MasteryCrown, type MasteryLevel } from "../ui/mastery-crown";
import { cn } from "../lib/utils";
import type { DojoPlatform } from "./types";

export type PathNodeState = "locked" | "available" | "in-progress" | "complete";

export type PathNodeView = {
  id: string;
  kind: "lesson" | "checkpoint";
  /** Curriculum title, already resolved for the locale (data). */
  title: string;
  minutes: number;
  state: PathNodeState;
  /** Lesson crown (0–5); only drawn once the node is complete. */
  crowns?: MasteryLevel;
  /** Some of this lesson's KCs have dropped below the crack threshold. */
  cracked?: boolean;
  /** Every item needs a code runner, and this build has none: disabled. */
  localOnly?: boolean;
  /** The learner's next step on the path. At most one per path. */
  current?: boolean;
  progress?: { done: number; total: number };
};

export type PathNodeProps = {
  node: PathNodeView;
  platform: DojoPlatform;
  onStart?: (nodeId: string) => void;
  className?: string;
};

const NODE_ICON = {
  locked: Lock,
  available: BookOpen,
  "in-progress": Code2,
  complete: Check,
} as const;

const STATE_KEY = {
  locked: "locked",
  available: "available",
  "in-progress": "inProgress",
  complete: "complete",
} as const;

/**
 * One lesson or checkpoint on the unit path. The node disc, its icon, the
 * state chip and the action label all encode the state, so it reads without
 * color. Checkpoints use a squared trophy disc to stand apart from lessons.
 */
export function PathNode({ node, platform, onStart, className }: PathNodeProps) {
  const t = useTranslations("dojo.path.node");
  const blockedNoRunner = node.localOnly === true && platform === "no-runner" && node.state !== "locked";
  const interactive = node.state !== "locked" && !blockedNoRunner && Boolean(onStart);
  const Icon = node.kind === "checkpoint" && node.state !== "complete" && node.state !== "locked" ? Trophy : NODE_ICON[node.state];
  const stateLabel = t(`state.${STATE_KEY[node.state]}`);
  const actionLabel = node.state === "complete" ? t("review") : node.state === "in-progress" ? t("continue") : t("start");
  const descriptionId = `${node.id}-desc`;

  return (
    <li
      className={cn("dj-dojo-node", className)}
      data-kind={node.kind}
      data-state={node.state}
      data-current={node.current ? "true" : undefined}
      data-blocked={blockedNoRunner ? "true" : undefined}
      aria-current={node.current ? "step" : undefined}
    >
      <span className="dj-dojo-node__disc" aria-hidden="true">
        <Icon />
      </span>
      <div className="dj-dojo-node__body">
        <div className="dj-dojo-node__heading">
          <span className="dj-dojo-node__kind dj-type-caption">{node.kind === "checkpoint" ? t("checkpoint") : t("lesson")}</span>
          {node.current ? <span className="dj-dojo-node__you dj-type-caption">{t("you")}</span> : null}
        </div>
        <h4 className="dj-dojo-node__title dj-type-label">{node.title}</h4>
        <p className="dj-dojo-node__meta dj-type-caption" id={descriptionId}>
          <span className="dj-dojo-chip" data-state={node.state}>{stateLabel}</span>
          <span>{t("minutes", { count: node.minutes })}</span>
          {node.progress && node.state === "in-progress" ? <span>{t("progress", { done: node.progress.done, total: node.progress.total })}</span> : null}
          {blockedNoRunner ? (
            <span className="dj-dojo-chip" data-state="local-only"><Laptop aria-hidden="true" />{t("localOnly")}</span>
          ) : null}
        </p>
        {blockedNoRunner ? <p className="dj-dojo-node__hint dj-type-caption">{t("localOnlyHint")}</p> : null}
      </div>
      <div className="dj-dojo-node__aside">
        {node.state === "complete" && typeof node.crowns === "number" ? (
          <MasteryCrown level={node.crowns} cracked={node.cracked} hidePips ariaLabel={t("crowns", { level: node.crowns, cracked: node.cracked ? "yes" : "no" })} />
        ) : null}
        {node.state !== "locked" ? (
          <Button
            variant={node.current ? "primary" : "outline"}
            size="sm"
            disabled={!interactive}
            onClick={interactive ? () => onStart?.(node.id) : undefined}
            aria-describedby={descriptionId}
            aria-label={t("actionAria", { action: actionLabel, title: node.title })}
          >
            {node.state === "complete" ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

export type UnitPathView = {
  id: string;
  /** 1-based position in the whole path ("Unit 3"). */
  ordinal: number;
  title: string;
  goal?: string;
  state: "locked" | "active" | "complete";
  crowns: MasteryLevel;
  cracked?: boolean;
  /** Title of the first unfinished prerequisite unit, for the lock note. */
  lockedAfter?: string;
  nodes: PathNodeView[];
};

export type UnitPathProps = {
  unit: UnitPathView;
  platform: DojoPlatform;
  onStartNode?: (nodeId: string) => void;
  /** Category tone of the unit's milestone tile; cycles by unit in the tier. */
  tone?: "amber" | "blue" | "magenta" | "indigo";
  className?: string;
};

/**
 * Unit header (milestone tile, title, goal, crown) above a single column of
 * nodes joined by a connector — the path reads top to bottom as a journey.
 */
export function UnitPath({ unit, platform, onStartNode, tone = "amber", className }: UnitPathProps) {
  const t = useTranslations("dojo.path");
  const headingId = `${unit.id}-title`;
  const done = unit.nodes.filter((node) => node.state === "complete").length;

  return (
    <section className={cn("dj-dojo-unit", className)} data-state={unit.state} aria-labelledby={headingId} data-panel>
      <header className="dj-dojo-unit__header">
        <span className="dj-practice-milestone-tile dj-dojo-unit__tile" data-tone={unit.state === "locked" ? "neutral" : tone} aria-hidden="true">
          {unit.state === "locked" ? <Lock /> : unit.state === "complete" ? <Check /> : <BookOpen />}
        </span>
        <span className="dj-dojo-unit__ordinal dj-type-caption">{t("unitOrdinal", { number: unit.ordinal })}</span>
        <h3 className="dj-dojo-unit__title dj-type-heading-md" id={headingId}>{unit.title}</h3>
        {unit.goal ? <p className="dj-dojo-unit__goal dj-type-body-sm">{unit.goal}</p> : null}
        <div className="dj-dojo-unit__status">
          <MasteryCrown level={unit.crowns} cracked={unit.cracked} ariaLabel={t("unitCrowns", { level: unit.crowns, cracked: unit.cracked ? "yes" : "no" })} />
          <span className="dj-type-caption dj-dojo-unit__count">{t("unitProgress", { done, total: unit.nodes.length })}</span>
        </div>
      </header>
      {unit.cracked && unit.state !== "locked" ? (
        <p className="dj-dojo-unit__note dj-type-body-sm" data-tone="cracked">{t("unitCracked")}</p>
      ) : null}
      {unit.state === "locked" ? (
        <p className="dj-dojo-unit__note dj-type-body-sm" data-tone="locked">
          <Lock aria-hidden="true" />
          {unit.lockedAfter ? t("unitLockedAfter", { unit: unit.lockedAfter }) : t("unitLocked")}
        </p>
      ) : null}
      <ol className="dj-dojo-unit__nodes">
        {unit.nodes.map((node) => (
          <PathNode key={node.id} node={node} platform={platform} onStart={onStartNode} />
        ))}
      </ol>
    </section>
  );
}

export type TierSectionProps = {
  /** Short tier code, e.g. "T0" (data). */
  code: string;
  title: string;
  unitsComplete: number;
  unitsTotal: number;
  children: React.ReactNode;
  className?: string;
};

/** Groups a tier's units under one heading with its completion count. */
export function TierSection({ code, title, unitsComplete, unitsTotal, children, className }: TierSectionProps) {
  const t = useTranslations("dojo.path");
  const id = React.useId();
  return (
    <section className={cn("dj-dojo-tier", className)} aria-labelledby={id}>
      <header className="dj-dojo-tier__header">
        <span className="dj-dojo-tier__code dj-type-data" aria-hidden="true">{code}</span>
        <h2 className="dj-dojo-tier__title dj-type-heading-lg" id={id}>{title}</h2>
        <span className="dj-dojo-tier__progress dj-type-caption">{t("tierProgress", { done: unitsComplete, total: unitsTotal })}</span>
      </header>
      <div className="dj-dojo-tier__units">{children}</div>
    </section>
  );
}
