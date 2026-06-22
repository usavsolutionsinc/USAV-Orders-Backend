'use client';

import React from 'react';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Cpu, Camera, Zap, ExternalLink, RefreshCw } from '@/components/Icons';
import { sectionLabel } from '@/design-system/tokens/typography/presets';
import { useLocalAgents, type AgentStatus, type LocalAgentState } from './useLocalAgents';
import { agentStatusMeta } from '@/lib/agent-status';

/**
 * OperationsAgentsRow — the "pair local agents to this UI" hook (roadmap
 * P3-ADM-01 acceptance C).
 *
 * It surfaces the REAL local/on-prem agents this operation runs, maps each to
 * the workflow stage it serves, and deep-links into the Operations Studio graph
 * (`/studio`) where that workflow is modeled. Status comes from live probes in
 * {@link useLocalAgents} — nothing here is a pretend stub.
 */

type AgentMeta = {
  id: LocalAgentState['id'];
  name: string;
  /** Which part of the workflow this agent maps onto. */
  stage: string;
  blurb: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Deep-link into the Studio graph / the surface the agent attaches to. */
  href: string;
};

const AGENT_META: Record<LocalAgentState['id'], AgentMeta> = {
  hermes: {
    id: 'hermes',
    name: 'Hermes',
    stage: 'Intake · Support · Sourcing',
    blurb: 'On-prem LLM — PO-email triage, claim drafts, parts sourcing.',
    Icon: Cpu,
    href: '/studio?lens=live',
  },
  vision: {
    id: 'vision',
    name: 'Vision',
    stage: 'Receiving · Identify',
    blurb: 'LAN RTX box — camera product recognition at receiving.',
    Icon: Camera,
    href: '/studio?lens=live&focus=receiving',
  },
  engine: {
    id: 'engine',
    name: 'Workflow engine',
    stage: 'Whole graph',
    blurb: 'Routes units through every node of the operations graph.',
    Icon: Zap,
    href: '/studio?lens=live',
  },
};

function AgentCard({ agent, index }: { agent: LocalAgentState; index: number }) {
  const meta = AGENT_META[agent.id];
  const tone = agentStatusMeta(agent.status);
  const { Icon } = meta;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="group relative flex flex-col rounded-[20px] border border-[#F0EDE8] bg-white p-4
                 shadow-[0_2px_12px_rgba(161,140,90,0.04)] transition-shadow
                 hover:shadow-[0_4px_18px_rgba(161,140,90,0.08)]"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#F5F3EF] text-[#6B6356]">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[14px] font-extrabold tracking-tight text-[#2D2A26]">
              {meta.name}
            </p>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider ${tone.chip}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              {tone.label}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#A89F91]">
            {meta.stage}
          </p>
        </div>
      </div>

      <p className="mt-3 text-[12px] font-medium leading-snug text-[#6B6356]">{meta.blurb}</p>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#F5F3EF] pt-2.5">
        <span className="truncate text-[11px] font-semibold tabular-nums text-[#A89F91]">
          {agent.detail}
        </span>
        <Link
          href={meta.href}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black uppercase tracking-wider text-[#6B6356] transition-colors hover:bg-[#F5F3EF] hover:text-[#2D2A26]"
        >
          Map in Studio
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
    </motion.div>
  );
}

export function OperationsAgentsRow() {
  const { agents, isLoading, refetch } = useLocalAgents();
  const order: LocalAgentState['id'][] = ['hermes', 'vision', 'engine'];
  const rows: LocalAgentState[] =
    agents ?? order.map((id) => ({ id, status: 'unknown' as AgentStatus, detail: 'Checking…' }));

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <span className={`${sectionLabel} !text-[#A89F91]`}>Local agents</span>
          <h2 className="mt-1 text-[20px] font-extrabold tracking-tight text-[#2D2A26] sm:text-[22px]">
            Agents paired to the workflow
          </h2>
        </div>
        <button
          type="button"
          onClick={refetch}
          disabled={isLoading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#E8E4DD] bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-[#6B6356] transition-colors hover:bg-[#F5F3EF] disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
          Re-check
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((agent, i) => (
          <AgentCard key={agent.id} agent={agent} index={i} />
        ))}
      </div>
    </section>
  );
}
