import TaskTable from '@/components/TaskTable'
import SessionLogger from '@/components/SessionLogger'
import Stats from '@/components/Stats'
import FocusTimer from '@/components/FocusTimer'
import DashboardToday from '@/components/DashboardToday'

export default function Home() {
  return (
    <main className="space-y-6">
      <section className="card p-5">
        <DashboardToday />
      </section>

      <section className="card p-5">
        <TaskTable />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-5">
          <FocusTimer />
        </div>
        <div className="card p-5">
          <SessionLogger />
        </div>
        <div className="card p-5">
          <Stats />
        </div>
      </section>
    </main>
  )
}
