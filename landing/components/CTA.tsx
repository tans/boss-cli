'use client'

export default function CTA() {
  return (
    <section className="py-24 px-6 border-t border-green-200">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-bold text-green-950 mb-8">立即开始使用</h2>
          <div className="flex flex-wrap gap-3">
            <a
              href="https://www.npmjs.com/package/@joohw/boss-cli"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-2.5 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold rounded-md transition-colors"
            >
              npm install -g @joohw/boss-cli@latest
            </a>
            <a
              href="https://github.com/joohw/boss-cli"
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-2.5 border border-green-300 hover:bg-green-100 text-green-950 text-sm font-medium rounded-md transition-colors"
            >
              在 GitHub 查看源码
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
