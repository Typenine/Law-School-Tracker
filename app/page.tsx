import SessionLogger from '@/components/SessionLogger'
import Stats from '@/components/Stats'
import FocusTimer from '@/components/FocusTimer'
import DashboardToday from '@/components/DashboardToday'
import PredictiveTimingCard from '@/components/PredictiveTimingCard'

export default function Home() {
  return (
    <main className="space-y-6">
      <section className="card p-5">
        <DashboardToday />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="card p-5">
          <FocusTimer />
        </div>
        <div className="card p-5">
          <SessionLogger />
        </div>
        <div className="card p-5">
          <PredictiveTimingCard />
        </div>
        <div className="card p-5">
          <Stats />
        </div>
      </section>
    </main>
  )
}
