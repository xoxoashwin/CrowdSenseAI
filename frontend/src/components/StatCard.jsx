import React from 'react';

export default function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  variant = 'forest', // 'forest' | 'sage' | 'accent'
  badge,
  badgeType = 'neutral', // 'neutral' | 'success' | 'warning' | 'danger'
}) {
  const iconVariants = {
    forest: 'bg-[#DCE8DD] text-[#37553A] border-[#AEC3B0]',
    sage: 'bg-[#E8F0E8] text-[#6B9071] border-[#D4E0D5]',
    accent: 'bg-[#D4E0D5] text-[#37553A] border-[#AEC3B0]',
  };

  const badgeStyles = {
    neutral: 'bg-[#DCE8DD] text-[#263B2B] border-[#D4E0D5]',
    success: 'bg-[#DCE8DD] text-[#37553A] border-[#AEC3B0] font-semibold',
    warning: 'bg-[#FFF6E5] text-[#7A4900] border-[#F0CD8C] font-bold',
    danger: 'bg-[#FDEAE9] text-[#7B2422] border-[#F5B7B5] font-bold',
  };

  const iconStyle = iconVariants[variant] || iconVariants.forest;

  return (
    <div className="bg-[#F7FAF6] rounded-2xl p-5 border border-[#D4E0D5] shadow-forest-card hover:shadow-forest-hover hover:border-[#6B9071] transition-all duration-200 relative overflow-hidden group">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-[#627466] tracking-wider uppercase">{title}</p>
          <div className="mt-2 flex items-baseline gap-2 flex-wrap">
            <h3 className="text-3xl font-extrabold tracking-tight text-[#263B2B] font-mono">
              {value !== undefined && value !== null ? value : '--'}
            </h3>
            {badge && (
              <span
                className={`text-[11px] px-2.5 py-0.5 rounded-full border ${
                  badgeStyles[badgeType] || badgeStyles.neutral
                }`}
              >
                {badge}
              </span>
            )}
          </div>
          {subtitle && <p className="mt-1.5 text-xs text-[#627466]">{subtitle}</p>}
        </div>

        {Icon && (
          <div className={`p-3 rounded-xl border shadow-2xs transition-transform group-hover:scale-105 duration-200 ${iconStyle}`}>
            <Icon className="w-5 h-5" />
          </div>
        )}
      </div>
    </div>
  );
}
