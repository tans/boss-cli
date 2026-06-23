'use client'

const features = [
  {
    title: '候选人列表管理',
  },
  {
    title: '智能会话操作',
  },
  {
    title: '批量消息发送',
  },
  {
    title: '职位与简历管理',
  },
  {
    title: '深度搜索与推荐',
  },
  {
    title: 'AI Agent 集成',
  }
]

export default function Features() {
  return (
    <section id="features" className="py-24 px-6 border-t border-green-200">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-green-950 mb-8">核心功能</h2>

        <div className="grid grid-cols-1 border-t border-green-200 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, i) => (
            <div key={i} className="border-b border-green-200 py-6 pr-6">
              <h3 className="text-green-950 font-semibold">{f.title}</h3>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
