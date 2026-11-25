import Link from 'next/link';
import { EMPLOYMENT_LABEL, postedAgo, WORK_MODE_LABEL, type EmploymentType, type WorkMode } from '@/lib/jobs';

export interface JobCardData {
  id: string;
  title: string;
  company_name: string;
  employment_type: EmploymentType;
  work_mode: WorkMode;
  salary_text: string | null;
  created_at: string;
  place: string;
}

export function JobCard({ job }: { job: JobCardData }) {
  return (
    <li>
      <Link href={`/vagas/${job.id}`} className="card block p-4 transition-colors hover:border-brand-600" data-testid="job-card">
        <p className="text-lg font-bold text-stone-900">{job.title}</p>
        <p className="text-stone-700">{job.company_name}</p>
        <p className="mt-2 flex flex-wrap gap-2 text-sm">
          <span className="tag bg-brand-50 text-brand-800">{EMPLOYMENT_LABEL[job.employment_type]}</span>
          <span className="tag bg-stone-100 text-stone-800">{WORK_MODE_LABEL[job.work_mode]}</span>
          {job.salary_text && <span className="tag bg-green-50 text-green-900">{job.salary_text}</span>}
        </p>
        <p className="mt-2 text-sm text-stone-600">{job.place} · publicada {postedAgo(job.created_at)}</p>
      </Link>
    </li>
  );
}
