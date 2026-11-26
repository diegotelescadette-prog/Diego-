import Link from 'next/link';
import { AREA_LABEL, EMPLOYMENT_LABEL, postedAgo, salaryLabel, WORK_MODE_LABEL, type EmploymentType, type JobArea, type WorkMode } from '@/lib/jobs';

export interface JobCardData {
  id: string;
  title: string;
  company_name: string;
  employment_type: EmploymentType;
  work_mode: WorkMode;
  salary_text: string | null;
  salary_min?: number | null;
  salary_max?: number | null;
  schedule_text?: string | null;
  area?: JobArea | null;
  poster_verified?: boolean;
  created_at: string;
  place: string;
}

export function VerifiedBadge({ label = 'Verificado' }: { label?: string }) {
  return (
    <span className="verified" data-testid="verified">
      <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5" /></svg>
      {label}
    </span>
  );
}

export function JobCard({ job }: { job: JobCardData }) {
  const salary = salaryLabel(job);
  return (
    <li>
      <Link href={`/vagas/${job.id}`} className="card block p-4 transition-colors hover:border-brand-300" data-testid="job-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="serif text-lg leading-snug text-stone-900">{job.title}</p>
          {job.poster_verified && <VerifiedBadge />}
        </div>
        <p className="text-stone-700">{job.company_name}</p>
        <p className="mt-2 flex flex-wrap gap-2 text-sm">
          {job.area && <span className="soft-tag mod-trabalho">{AREA_LABEL[job.area]}</span>}
          <span className="soft-tag mod-servicos">{EMPLOYMENT_LABEL[job.employment_type]}</span>
          <span className="soft-tag mod-eventos">{WORK_MODE_LABEL[job.work_mode]}</span>
          {salary && <span className="soft-tag bg-surface text-stone-800 ring-1 ring-line" data-testid="job-salary">{salary}</span>}
        </p>
        <p className="mt-2 text-sm text-stone-600">{job.place} · publicada {postedAgo(job.created_at)}</p>
      </Link>
    </li>
  );
}
