import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

/** A long-running bulk operation shown in the task dock (e.g. bulk "Hide related"). */
export interface Task {
  id: number
  title: string
  /** Past-tense verb for finished items, e.g. "deleted" */
  verb: string
  total: number
  done: number
  failed: number
  errors: string[]
  status: 'running' | 'done' | 'cancelled'
  /** Item currently being processed, for display */
  current?: string
  startedAt: number
  finishedAt?: number
}

export interface TaskHandle {
  signal: AbortSignal
  /** Mark one item finished (pass an error message if it failed). */
  step: (label: string, error?: string) => void
  /** Show which item is being processed now. */
  working: (label: string) => void
  finish: () => void
}

interface Ctx {
  tasks: Task[]
  start: (title: string, total: number, verb?: string) => TaskHandle
  cancel: (id: number) => void
  dismiss: (id: number) => void
}

const TaskCtx = createContext<Ctx | null>(null)
let seq = 0

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const controllers = useRef(new Map<number, AbortController>())

  const patch = useCallback((id: number, fn: (t: Task) => Task) => setTasks((list) => list.map((t) => (t.id === id ? fn(t) : t))), [])

  const start = useCallback((title: string, total: number, verb = 'updated'): TaskHandle => {
    const id = ++seq
    const ctl = new AbortController()
    controllers.current.set(id, ctl)
    setTasks((list) => [...list.filter((t) => t.status === 'running'), { id, title, verb, total, done: 0, failed: 0, errors: [], status: 'running', startedAt: Date.now() }])
    return {
      signal: ctl.signal,
      step: (label, error) => patch(id, (t) => ({
        ...t,
        done: t.done + 1,
        failed: t.failed + (error ? 1 : 0),
        errors: error ? [...t.errors, `${label}: ${error}`] : t.errors,
      })),
      working: (label) => patch(id, (t) => ({ ...t, current: label })),
      finish: () => {
        controllers.current.delete(id)
        patch(id, (t) => ({ ...t, status: t.status === 'cancelled' ? 'cancelled' : 'done', current: undefined, finishedAt: Date.now() }))
      },
    }
  }, [patch])

  const cancel = useCallback((id: number) => {
    controllers.current.get(id)?.abort()
    patch(id, (t) => ({ ...t, status: 'cancelled' }))
  }, [patch])

  const dismiss = useCallback((id: number) => setTasks((list) => list.filter((t) => t.id !== id)), [])

  return <TaskCtx.Provider value={{ tasks, start, cancel, dismiss }}>{children}</TaskCtx.Provider>
}

export function useTasks() {
  const c = useContext(TaskCtx)
  if (!c) throw new Error('useTasks outside TaskProvider')
  return c
}
