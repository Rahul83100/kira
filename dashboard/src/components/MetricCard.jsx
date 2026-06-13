export default function MetricCard({ title, value, subtitle, icon, trend, color = 'brand' }) {
  const colorMap = {
    brand: {
      bg: 'bg-brand-50',
      text: 'text-brand-600',
      icon: 'bg-brand-100 text-brand-600',
    },
    green: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-600',
      icon: 'bg-emerald-100 text-emerald-600',
    },
    amber: {
      bg: 'bg-amber-50',
      text: 'text-amber-600',
      icon: 'bg-amber-100 text-amber-600',
    },
    blue: {
      bg: 'bg-blue-50',
      text: 'text-blue-600',
      icon: 'bg-blue-100 text-blue-600',
    },
  };

  const colors = colorMap[color] || colorMap.brand;

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-all duration-300 hover:-translate-y-0.5 group animate-fade-in">
      <div className="flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl ${colors.icon} flex items-center justify-center transition-transform duration-300 group-hover:scale-110`}>
          {icon}
        </div>
        {trend && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
            trend > 0 
              ? 'bg-emerald-50 text-emerald-600' 
              : 'bg-red-50 text-red-600'
          }`}>
            {trend > 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <p className="text-sm font-medium text-gray-500 mb-1">{title}</p>
      <p className="text-3xl font-bold text-gray-900 tracking-tight">{value}</p>
      {subtitle && (
        <p className="text-xs text-gray-400 mt-1.5">{subtitle}</p>
      )}
    </div>
  );
}
