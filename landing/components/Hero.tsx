'use client'

export default function Hero() {
  return (
    <section className="pt-40 pb-24 px-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-5xl sm:text-6xl font-bold text-green-950 leading-tight tracking-tight mb-8">
          Boss直聘
          <br />
          <span className="text-green-700">自动化工具</span>
        </h1>

        <div className="flex flex-wrap gap-3 mb-12">
          <a
            href="https://www.npmjs.com/package/@joohw/boss-cli"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-2.5 bg-green-700 hover:bg-green-800 text-white font-semibold rounded-md text-sm transition-colors"
          >
            npm install
          </a>
          <a
            href="https://github.com/joohw/boss-cli#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-2.5 border border-green-300 hover:bg-green-100 text-green-950 rounded-md text-sm font-medium transition-colors"
          >
            查看文档
          </a>
        </div>

        <div className="border-l-2 border-green-700 pl-5 max-w-lg">
          <div className="space-y-2 font-mono text-sm">
            <div>
              <span className="text-green-500 select-none">$ </span>
              <span className="text-green-800">npm install -g @joohw/boss-cli@latest</span>
            </div>
            <div>
              <span className="text-green-500 select-none">$ </span>
              <span className="text-green-800">boss help</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
