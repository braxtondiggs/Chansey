export interface ChartTooltipOptions {
  mobileBreakpoint?: number;
}

/**
 * Creates an external chart tooltip handler for Chart.js.
 * Renders a styled tooltip element with date and currency value.
 */
export function createExternalChartTooltip(options: ChartTooltipOptions = {}) {
  const breakpoint = options.mobileBreakpoint ?? 768;

  return function externalTooltipHandler(context: any) {
    const { chart, tooltip } = context;
    let el = chart.canvas.parentNode.querySelector('div.chartjs-tooltip') as HTMLDivElement | null;
    if (!el) {
      el = document.createElement('div');
      el.classList.add(
        'chartjs-tooltip',
        'px-3',
        'py-2',
        'dark:bg-surface-950/90',
        'bg-surface-0/90',
        'rounded-xl',
        'flex',
        'flex-col',
        'items-center',
        'justify-center',
        'border',
        'border-surface',
        'pointer-events-none',
        'absolute',
        '-translate-x-1/2',
        'shadow-md'
      );
      chart.canvas.parentNode.appendChild(el);
    }

    const tooltipEl: HTMLDivElement = el;

    if (tooltip.opacity === 0) {
      tooltipEl.style.opacity = '0';
      return;
    }

    const isMobile = window.innerWidth < breakpoint;

    if (tooltip.body) {
      const bodyLines = tooltip.body.map((b: any) => {
        const line = b.lines[0];
        const colonIdx = line.indexOf(':');
        const value = colonIdx >= 0 ? line.substring(colonIdx + 1).trim() : line.trim();
        return {
          title: tooltip.title[0].trim(),
          value
        };
      });

      tooltipEl.innerHTML = '';
      bodyLines.forEach((body: any) => {
        const dateLine = document.createElement('div');
        dateLine.textContent = body.title;
        dateLine.classList.add('text-surface-500', 'dark:text-surface-400', 'whitespace-nowrap');
        dateLine.style.fontSize = isMobile ? '12px' : '11px';
        dateLine.style.lineHeight = '1.4';

        const valueLine = document.createElement('div');
        valueLine.textContent = `$${body.value}`;
        valueLine.classList.add('text-surface-950', 'dark:text-surface-0', 'font-semibold', 'whitespace-nowrap');
        valueLine.style.fontSize = isMobile ? '16px' : '14px';
        valueLine.style.lineHeight = '1.3';

        tooltipEl.appendChild(dateLine);
        tooltipEl.appendChild(valueLine);
      });
    }

    const { offsetLeft: positionX, offsetTop: positionY } = chart.canvas;
    tooltipEl.style.opacity = '1';

    if (isMobile) {
      tooltipEl.style.left = positionX + chart.width / 2 + 'px';
      tooltipEl.style.top = positionY + 16 + 'px';
      tooltipEl.style.transform = 'translateX(-50%)';
    } else {
      const tooltipWidth = tooltipEl.offsetWidth || 120;
      const halfTooltip = tooltipWidth / 2;
      const minLeft = positionX + halfTooltip + 8;
      const maxLeft = positionX + chart.width - halfTooltip - 8;
      const rawLeft = positionX + tooltip.caretX;
      const clampedLeft = Math.min(Math.max(rawLeft, minLeft), maxLeft);
      tooltipEl.style.left = clampedLeft + 'px';
      tooltipEl.style.top = positionY + tooltip.caretY - 60 + 'px';
      tooltipEl.style.transform = 'translateX(-50%)';
    }
  };
}
