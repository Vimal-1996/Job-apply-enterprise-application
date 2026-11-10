import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useEffect, useState } from 'react';
import { useAuth } from 'react-oidc-context';
import { Link } from 'react-router-dom';
import { ApiError, apiGet, apiPatch } from '../../api/client';
import type { ApplicationStatus, JobSummary } from '../../api/types';
import { Spinner } from '../../components/ui';
import { formatDate } from '../admin/format';
import { groupByStatus, moveJob, pipelineCounts, STATUSES, statusInfo } from './applicationView';
import { MatchBadge } from './JobsPage';
import { jobTitle } from './jobView';

const label = (s: ApplicationStatus) => statusInfo(s).label;

/**
 * The application pipeline as a board: one column per stage. Drag a job to
 * another column (mouse, touch, or keyboard: Space to pick up, arrows to
 * move, Space to drop) or use its "Move to" menu. Changes save straight away.
 */
export function ApplicationsPage() {
  const token = useAuth().user?.access_token;
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<JobSummary | null>(null);

  useEffect(() => {
    apiGet<JobSummary[]>('/jobs', token)
      .then(setJobs)
      .catch(() => setLoadError(true));
  }, [token]);

  const sensors = useSensors(
    // A short distance before dragging starts, so clicking a job's link still opens it.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  /** Moves the card at once, saves, and puts it back if saving fails. */
  const move = async (id: string, status: ApplicationStatus) => {
    if (!jobs) return;
    const prev = jobs.find((j) => j.id === id);
    const after = moveJob(jobs, id, status, new Date().toISOString());
    if (!prev || after === jobs) return;
    setJobs(after);
    setError(null);
    try {
      await apiPatch(`/jobs/${encodeURIComponent(id)}/application`, token, { status });
    } catch (e) {
      // Put just this job back (other cards may have moved meanwhile).
      setJobs((cur) => cur?.map((j) => (j.id === id ? { ...j, applicationStatus: prev.applicationStatus, statusChangedAt: prev.statusChangedAt } : j)) ?? null);
      setError(`Couldn't move “${jobTitle(prev)}”: ${e instanceof ApiError ? e.message : 'please try again.'}`);
    }
  };

  const onDragStart = (e: DragStartEvent) => setDragging(jobs?.find((j) => j.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    if (e.over) void move(String(e.active.id), e.over.id as ApplicationStatus);
  };

  const titleOf = (id: string | number) => {
    const j = jobs?.find((x) => x.id === id);
    return j ? jobTitle(j) : 'job';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}. Use the arrow keys to choose a stage, Space to drop, Escape to cancel.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} is over ${label(over.id as ApplicationStatus)}.` : `${titleOf(active.id)} is not over a stage.`),
    onDragEnd: ({ active, over }) => (over ? `Moved ${titleOf(active.id)} to ${label(over.id as ApplicationStatus)}.` : `${titleOf(active.id)} was dropped outside the board. Nothing changed.`),
    onDragCancel: ({ active }) => `Cancelled. ${titleOf(active.id)} stays where it was.`,
  };

  if (loadError) return <div className="banner">⚠️ Could not load your applications. Check that the API is running, then refresh.</div>;
  if (!jobs)
    return (
      <div className="center" style={{ minHeight: 160 }}>
        <Spinner />
      </div>
    );

  const c = pipelineCounts(jobs);
  const stats = [
    { label: 'Applied', value: c.applied },
    { label: 'In progress', value: c.active },
    { label: 'Interviewing', value: c.interviewing },
    { label: 'Offers', value: c.offers },
  ];

  return (
    <>
      <header className="page-head">
        <h1>Applications</h1>
        <p>Drag a job to another stage as things move along, or use its “Move to” menu. Changes save straight away.</p>
      </header>

      {jobs.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>
            No jobs yet. <Link to="/jobs">Add a job</Link> to start tracking your applications.
          </p>
        </div>
      ) : (
        <>
          <div className="grid" style={{ marginBottom: 16 }}>
            {stats.map((s) => (
              <div key={s.label} className="card stat">
                <div className="value">{s.value}</div>
                <div className="label">{s.label}</div>
              </div>
            ))}
          </div>

          {error && (
            <div className="banner" role="alert" style={{ marginBottom: 12 }}>
              ⚠️ {error}
            </div>
          )}

          <DndContext
            sensors={sensors}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setDragging(null)}
            accessibility={{
              announcements,
              screenReaderInstructions: {
                draggable: 'To move this job to another stage, press Space, use the arrow keys to choose the stage, then press Space again. Or use its Move to menu.',
              },
            }}
          >
            <div className="board" aria-label="Application stages">
              {groupByStatus(jobs).map((g) => (
                <Column key={g.value} status={g.value} title={g.label} closed={g.closed} jobs={g.jobs} onMove={move} />
              ))}
            </div>
            <DragOverlay>{dragging && <CardBody job={dragging} lifted />}</DragOverlay>
          </DndContext>
        </>
      )}
    </>
  );
}

function Column(props: { status: ApplicationStatus; title: string; closed?: boolean; jobs: JobSummary[]; onMove: (id: string, s: ApplicationStatus) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: props.status });
  return (
    <section ref={setNodeRef} className={`board-col${isOver ? ' over' : ''}${props.closed ? ' closed' : ''}`} aria-label={`${props.title}, ${props.jobs.length} jobs`}>
      <div className="row board-col-head">
        <h3 style={{ margin: 0 }}>{props.title}</h3>
        <span className="muted">{props.jobs.length}</span>
      </div>
      <ul className="board-list">
        {props.jobs.map((j) => (
          <DraggableCard key={j.id} job={j} onMove={props.onMove} />
        ))}
        {props.jobs.length === 0 && <li className="board-empty muted">Drop a job here</li>}
      </ul>
    </section>
  );
}

function DraggableCard({ job, onMove }: { job: JobSummary; onMove: (id: string, s: ApplicationStatus) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: job.id });
  return (
    <li ref={setNodeRef} className="board-card" style={{ opacity: isDragging ? 0.35 : 1 }} {...attributes} {...listeners} aria-roledescription="draggable job">
      <CardBody job={job} />
      <label className="board-move" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <span className="visually-hidden">Move {jobTitle(job)} to</span>
        <select className="input" value={job.applicationStatus} onChange={(e) => onMove(job.id, e.target.value as ApplicationStatus)}>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.value === job.applicationStatus ? `Move to…` : s.label}
            </option>
          ))}
        </select>
      </label>
    </li>
  );
}

function CardBody({ job, lifted = false }: { job: JobSummary; lifted?: boolean }) {
  return (
    <div className={`board-card-body${lifted ? ' lifted' : ''}`}>
      <Link to={`/jobs/${job.id}`} className="board-title" onPointerDown={(e) => e.stopPropagation()}>
        {jobTitle(job)}
      </Link>
      <span className="cell-sub">{[job.company, formatDate(job.statusChangedAt ?? job.createdAt)].filter(Boolean).join(' · ')}</span>
      <MatchBadge job={job} />
    </div>
  );
}
