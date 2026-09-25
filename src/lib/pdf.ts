/** Renders an on-page element (Hebrew text is drawn by the browser, so RTL stays correct) into an A4 PDF. */
export async function elementToPdf(el: HTMLElement): Promise<Blob> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const canvas = await toCanvas(el, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: false });
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  const pageW = 210;
  const pageH = 297;
  const margin = 8;
  const usableW = pageW - margin * 2;
  const usableH = pageH - margin * 2;
  const pxPerMm = canvas.width / usableW;
  const slicePx = Math.floor(usableH * pxPerMm);

  // cut on white rows where possible, so text lines are not split between pages
  const ctx = canvas.getContext('2d')!;
  const isBlankRow = (y: number) => {
    const row = ctx.getImageData(0, y, canvas.width, 1).data;
    for (let i = 0; i < row.length; i += 16) if (row[i] < 245 || row[i + 1] < 245 || row[i + 2] < 245) return false;
    return true;
  };

  let y = 0;
  let first = true;
  while (y < canvas.height) {
    let h = Math.min(slicePx, canvas.height - y);
    if (y + h < canvas.height) {
      for (let back = 0; back < 240 && h - back > slicePx / 2; back += 2) {
        if (isBlankRow(y + h - back)) {
          h -= back;
          break;
        }
      }
    }
    const part = document.createElement('canvas');
    part.width = canvas.width;
    part.height = h;
    part.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    if (!first) pdf.addPage();
    pdf.addImage(part.toDataURL('image/jpeg', 0.9), 'JPEG', margin, margin, usableW, h / pxPerMm);
    first = false;
    y += h;
  }
  return pdf.output('blob');
}
