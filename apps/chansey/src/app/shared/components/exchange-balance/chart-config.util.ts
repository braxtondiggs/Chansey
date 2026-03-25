import { ChartData, ChartOptions } from 'chart.js';

import { AccountValueDataPoint } from '@chansey/api-interfaces';

import { createExternalChartTooltip } from '../../utils/chart-tooltip.util';

export const CHART_CONFIG = {
  tension: 0.6,
  borderWidth: { desktop: 1.2, mobile: 2 },
  pointBorderWidth: 8,
  pointRadius: 4,
  mobileBreakpoint: 768,
  maxTicksLimit: { desktop: 10, mobile: 5 },
  maxRotation: { desktop: 0, mobile: 45 },
  fontSize: { desktop: 12, mobile: 10 },
  gridLineWidth: { desktop: 1.2, mobile: 0.8 },
  hoverRadius: { desktop: 6, mobile: 8 },
  hitRadius: { desktop: 20, mobile: 30 },
  decimationSamples: { desktop: 100, mobile: 50 },
  decimationThreshold: { desktop: 40, mobile: 20 },
  animationDuration: 400,
  largeDaysThreshold: 30,
  mediumDaysThreshold: 7
} as const;

export interface BalanceChartOptions {
  isDarkTheme: boolean;
  isMobile: boolean;
  isBalanceHidden: boolean;
  currentDays: number;
  bgColor: string[] | undefined;
  borderColor: string | undefined;
}

export interface BalanceChartResult {
  chartData: ChartData;
  chartOptions: ChartOptions;
  chartPlugins: any[];
}

function getTimeUnit(
  days: number
): 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year' {
  if (days === 0) return 'quarter';
  if (days <= 1) return 'hour';
  if (days <= 7) return 'day';
  if (days <= 30) return 'week';
  if (days <= 365) return 'month';
  return 'quarter';
}

export function buildBalanceChartConfig(
  historyData: AccountValueDataPoint[],
  options: BalanceChartOptions
): BalanceChartResult {
  const { isDarkTheme, isMobile, isBalanceHidden, currentDays, bgColor, borderColor } = options;

  const rootStyles = getComputedStyle(document.documentElement);
  const surface400Color = rootStyles.getPropertyValue('--p-surface-400');
  const surface500Color = rootStyles.getPropertyValue('--p-surface-500');
  const surface200Color = rootStyles.getPropertyValue('--p-surface-200');
  const surface800Color = rootStyles.getPropertyValue('--p-surface-800');
  const surface0Color = rootStyles.getPropertyValue('--p-surface-0');
  const surface950Color = rootStyles.getPropertyValue('--p-surface-950');
  const endDate = historyData[historyData.length - 1].datetime;
  const startDate = historyData[0].datetime;

  const timeUnit = getTimeUnit(currentDays);
  const days = currentDays;

  const chartData: ChartData = {
    datasets: [
      {
        label: 'Account Value (USD)',
        data: historyData.map((point) => ({
          x: new Date(point.datetime).getTime(),
          y: point.value
        })),
        fill: true,
        borderColor: borderColor ?? (isDarkTheme ? '#FAFAFA' : '#030616'),
        tension: CHART_CONFIG.tension,
        borderWidth: CHART_CONFIG.borderWidth.desktop,
        pointBorderColor: 'rgba(0, 0, 0, 0)',
        pointBackgroundColor: 'rgba(0, 0, 0, 0)',
        pointHoverBackgroundColor: borderColor ?? (isDarkTheme ? surface0Color : surface950Color),
        pointHoverBorderColor: isDarkTheme ? surface950Color : surface0Color,
        pointBorderWidth: CHART_CONFIG.pointBorderWidth,
        pointStyle: 'circle',
        pointRadius: CHART_CONFIG.pointRadius,
        backgroundColor: (context: any) => {
          const defaultColor = [
            isDarkTheme ? 'rgba(255, 255, 255, 0.24)' : 'rgba(3, 6, 22, 0.12)',
            isDarkTheme ? 'rgba(255, 255, 255, 0)' : 'rgba(3, 6, 22, 0)'
          ];
          const bg_ = bgColor ?? defaultColor;

          if (!context.chart.chartArea) {
            return;
          }

          const {
            ctx,
            chartArea: { top, bottom }
          } = context.chart;
          const gradientBg = ctx.createLinearGradient(0, top, 0, bottom);
          const colorTranches = 1 / (bg_.length - 1);

          bg_.forEach((color, index) => {
            gradientBg.addColorStop(index * colorTranches, color);
          });

          return gradientBg;
        }
      }
    ]
  };

  // Cache computed style values for the hover line plugin (avoid per-frame getComputedStyle)
  const hoverLineColor = borderColor ?? (isDarkTheme ? surface0Color : surface950Color);

  const chartPlugins: any[] = [
    {
      id: 'hoverLine',
      afterDatasetsDraw: (chart: any) => {
        if (isBalanceHidden) return;

        const {
          ctx,
          tooltip,
          chartArea: { bottom },
          scales: { x, y }
        } = chart;
        if (tooltip?._active?.length > 0) {
          const xCoor = x.getPixelForValue(tooltip.dataPoints[0].raw.x);
          const yCoor = y.getPixelForValue(tooltip.dataPoints[0].parsed.y);
          ctx.save();
          ctx.beginPath();
          ctx.lineWidth = CHART_CONFIG.borderWidth.desktop;
          ctx.strokeStyle = hoverLineColor;
          ctx.setLineDash([4, 2]);
          ctx.moveTo(xCoor, yCoor);
          ctx.lineTo(xCoor, bottom + 8);
          ctx.stroke();
          ctx.closePath();
          ctx.restore();
        }
      }
    }
  ];

  const chartOptions: ChartOptions = {
    maintainAspectRatio: false,
    responsive: true,
    interaction: isBalanceHidden
      ? { intersect: false, mode: 'none' as any }
      : { intersect: false, mode: 'index', axis: 'xy', includeInvisible: true },
    animation: {
      duration: isMobile ? 0 : days > CHART_CONFIG.largeDaysThreshold ? 0 : CHART_CONFIG.animationDuration
    },
    elements: {
      point: {
        radius: isMobile
          ? 0
          : days > CHART_CONFIG.largeDaysThreshold
            ? 0
            : days > CHART_CONFIG.mediumDaysThreshold
              ? 1
              : 2,
        hoverRadius: isBalanceHidden
          ? 0
          : isMobile
            ? CHART_CONFIG.hoverRadius.mobile
            : CHART_CONFIG.hoverRadius.desktop,
        hitRadius: isBalanceHidden ? 0 : isMobile ? CHART_CONFIG.hitRadius.mobile : CHART_CONFIG.hitRadius.desktop
      },
      line: {
        tension: CHART_CONFIG.tension,
        borderWidth: isMobile ? CHART_CONFIG.borderWidth.mobile : CHART_CONFIG.borderWidth.desktop
      }
    },
    scales: {
      x: {
        type: 'time',
        time: {
          unit: timeUnit,
          displayFormats: {
            hour: 'h:mm a',
            day: 'MMM d',
            week: 'MMM d',
            month: 'MMM yyyy',
            quarter: 'MMM yyyy'
          },
          tooltipFormat: 'MMM d yyyy, h:mm a'
        },
        ticks: {
          color: isDarkTheme ? surface500Color : surface400Color,
          padding: 2,
          autoSkip: true,
          maxTicksLimit: isMobile ? CHART_CONFIG.maxTicksLimit.mobile : CHART_CONFIG.maxTicksLimit.desktop,
          maxRotation: isMobile ? CHART_CONFIG.maxRotation.mobile : CHART_CONFIG.maxRotation.desktop,
          source: 'auto',
          font: {
            size: isMobile ? CHART_CONFIG.fontSize.mobile : CHART_CONFIG.fontSize.desktop
          }
        },
        grid: {
          display: true,
          lineWidth: isMobile ? CHART_CONFIG.gridLineWidth.mobile : CHART_CONFIG.gridLineWidth.desktop,
          color: isDarkTheme ? surface800Color : surface200Color
        },
        border: {
          display: false,
          dash: [4, 2]
        },
        min: new Date(startDate).valueOf(),
        max: new Date(endDate).valueOf()
      },
      y: {
        beginAtZero: false,
        display: false
      }
    },
    plugins: {
      tooltip: isBalanceHidden
        ? { enabled: false }
        : {
            enabled: false,
            position: 'nearest',
            external: createExternalChartTooltip({ mobileBreakpoint: CHART_CONFIG.mobileBreakpoint })
          },
      legend: { display: false },
      title: { display: false },
      decimation: {
        enabled: true,
        algorithm: 'lttb',
        samples: isMobile ? CHART_CONFIG.decimationSamples.mobile : CHART_CONFIG.decimationSamples.desktop,
        threshold: isMobile ? CHART_CONFIG.decimationThreshold.mobile : CHART_CONFIG.decimationThreshold.desktop
      }
    }
  };

  return { chartData, chartOptions, chartPlugins };
}
