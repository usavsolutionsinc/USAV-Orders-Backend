'use client';

interface Tab {
  id: string;
  label: string;
  color?: 'blue' | 'emerald' | 'orange' | 'purple';
}

interface TabSwitchProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

export function TabSwitch({ tabs, activeTab, onTabChange, className = '' }: TabSwitchProps) {
  const getColorClasses = (color: string = 'blue', isActive: boolean) => {
    if (!isActive) {
      return 'text-gray-500 hover:text-gray-700';
    }

    const colorMap: { [key: string]: string } = {
      blue: 'bg-white text-blue-600 shadow-sm',
      emerald: 'bg-white text-emerald-600 shadow-sm',
      orange: 'bg-white text-orange-600 shadow-sm',
      purple: 'bg-white text-purple-600 shadow-sm',
    };

    return colorMap[color] || colorMap.blue;
  };

  return (
    <div className={`flex gap-2 bg-gray-100 rounded-xl p-1 ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`flex-1 px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
            getColorClasses(tab.color, activeTab === tab.id)
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
