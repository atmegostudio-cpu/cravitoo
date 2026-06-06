import React, { useState } from 'react';
import axios from 'axios';
import { FileSpreadsheet, FileText, Download, Loader2 } from 'lucide-react';

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

/**
 * ExportButtons — three buttons (XLSX / CSV / PDF) that download a report.
 *
 * Props:
 *  - endpoint: e.g. "/exports/reservations" (will be prefixed with /api by axios baseURL)
 *  - params:  object of query params (date_from, date_to, etc.)
 *  - filename: base filename (no extension)
 *  - testidPrefix: optional, defaults to endpoint slug
 */
const ExportButtons = ({ endpoint, params = {}, filename = 'cravitoo-report', testidPrefix }) => {
  const [busyFmt, setBusyFmt] = useState(null);
  const tid = testidPrefix || endpoint.replace(/\W/g, '-');

  const download = async (fmt) => {
    setBusyFmt(fmt);
    try {
      const resp = await axios.get(`${API}${endpoint}`, {
        params: { ...params, format: fmt },
        responseType: 'blob',
        withCredentials: true,
      });
      const blob = new Blob([resp.data], {
        type: resp.headers['content-type'] || 'application/octet-stream',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename}.${fmt}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      const txt = await err?.response?.data?.text?.().catch(() => '');
      alert(`Export failed: ${txt || err.message}`);
    } finally {
      setBusyFmt(null);
    }
  };

  const Btn = ({ fmt, label, Icon }) => (
    <button
      type="button"
      onClick={() => download(fmt)}
      disabled={busyFmt !== null}
      data-testid={`${tid}-export-${fmt}`}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-card border border-border-light hover:border-primary rounded-lg text-text-secondary hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {busyFmt === fmt ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-text-muted hidden sm:inline">Export:</span>
      <Btn fmt="xlsx" label="Excel" Icon={FileSpreadsheet} />
      <Btn fmt="csv" label="CSV" Icon={Download} />
      <Btn fmt="pdf" label="PDF" Icon={FileText} />
    </div>
  );
};

export default ExportButtons;
