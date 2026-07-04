'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from '@/components/Icons';
import {
  Truck,
  Cpu,
  PackageSearch,
  Headset,
  LayoutGrid,
  CheckCircle2,
  type LucideIcon,
} from 'lucide-react';

type DomainLink = {
  name: string;
  href: string;
  badge?: string;
  active?: boolean;
};

type DomainTone = {
  iconClass: string;
  badgeClass: string;
};

type Domain = {
  title: string;
  icon: LucideIcon;
  tone: DomainTone;
  links: DomainLink[];
};

const TONE_AMBER: DomainTone = {
  iconClass: 'text-amber-600 bg-amber-50',
  badgeClass: 'text-amber-700 bg-amber-100',
};

const TONE_SAGE: DomainTone = {
  iconClass: 'text-[#6B9080] bg-[#6B9080]/10',
  badgeClass: 'text-[#6B9080] bg-[#6B9080]/10',
};

const TONE_TERRACOTTA: DomainTone = {
  iconClass: 'text-[#E07A5F] bg-[#E07A5F]/10',
  badgeClass: 'text-[#E07A5F] bg-[#E07A5F]/10',
};

const TONE_INDIGO: DomainTone = {
  iconClass: 'text-indigo-500 bg-indigo-50',
  badgeClass: 'text-indigo-600 bg-indigo-100',
};

const DOMAINS: Domain[] = [
  {
    title: 'Logistics & Fulfillment',
    icon: Truck,
    tone: TONE_AMBER,
    links: [
      { name: 'Order Packing', href: '/packer', badge: '14 Pending' },
      { name: 'FBA Intake', href: '/fba' },
      { name: 'Shipping & Tracking', href: '/shipping' },
      { name: 'Pick Lists', href: '/pick' },
    ],
  },
  {
    title: 'Inventory & Receiving',
    icon: PackageSearch,
    tone: TONE_SAGE,
    links: [
      { name: 'Receiving Dock', href: '/receiving', active: true },
      { name: 'Replenishment', href: '/inventory?section=replenish' },
      { name: 'Warehouse Locations', href: '/warehouse' },
      { name: 'SKU Catalog', href: '/products' },
    ],
  },
  {
    title: 'Tech & Repair',
    icon: Cpu,
    tone: TONE_TERRACOTTA,
    links: [
      { name: 'Serial Number Intake', href: '/tech', badge: 'Critical' },
      { name: 'Device Repairs', href: '/repair' },
    ],
  },
  {
    title: 'Support & Customers',
    icon: Headset,
    tone: TONE_INDIGO,
    links: [
      { name: 'Returns & RMA', href: '/support', active: true },
      { name: 'Walk-in Customers', href: '/walk-in' },
      { name: 'Support Tickets', href: '/support' },
    ],
  },
];

export const OperationsMatrix: React.FC = () => {
  return (
    <section className="bg-surface-card rounded-3xl shadow-[0_4px_24px_rgba(161,140,90,0.06)] p-8">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border-soft pb-6 mb-6">
        <div>
          <h2 className="text-xl font-bold text-text-default tracking-tight">
            Operations Hub
          </h2>
          <p className="text-sm text-text-muted font-medium mt-0.5">
            Direct access to facility modules
          </p>
        </div>
        <div className="p-3 bg-amber-50 rounded-2xl">
          <LayoutGrid className="h-6 w-6 text-amber-500" />
        </div>
      </div>

      {/* Domain Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        {DOMAINS.map((domain, idx) => {
          const Icon = domain.icon;

          return (
            <motion.div key={idx} className="flex flex-col h-full">
              {/* Domain Header */}
              <div className="flex items-center gap-3 mb-5">
                <div
                  className={`p-2.5 rounded-xl ${domain.tone.iconClass}`}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-sm font-bold text-text-default">
                  {domain.title}
                </h3>
              </div>

              {/* Links */}
              <ul className="space-y-1">
                {domain.links.map((link, lIdx) => (
                  <li key={lIdx}>
                    <a
                      href={link.href}
                      className="group flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-amber-50/40 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {/* Active / Inactive indicator */}
                        <div
                          className={`flex shrink-0 items-center justify-center w-5 h-5 rounded-full ${
                            link.active
                              ? 'bg-[#2D2A26] text-white'
                              : 'border border-border-soft text-transparent'
                          }`}
                        >
                          {link.active && (
                            <CheckCircle2 className="w-3 h-3" />
                          )}
                        </div>
                        <span
                          className={`text-sm font-medium ${
                            link.active
                              ? 'text-text-default'
                              : 'text-text-muted'
                          } group-hover:text-text-default transition-colors`}
                        >
                          {link.name}
                        </span>
                      </div>

                      {link.badge ? (
                        <span
                          className={`text-micro uppercase tracking-widest font-bold px-2 py-1 rounded-full ${domain.tone.badgeClass}`}
                        >
                          {link.badge}
                        </span>
                      ) : (
                        <ChevronRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </a>
                  </li>
                ))}
              </ul>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
};
