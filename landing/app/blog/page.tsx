import type { Metadata } from 'next'
import Link from 'next/link'
import Footer from '@/components/Footer'
import Navbar from '@/components/Navbar'
import { getAllBlogPosts } from '@/lib/blog'
import { SITE_URL } from '@/lib/site'

export const metadata: Metadata = {
  title: '博客',
  description:
    'boss-cli 博客：Boss直聘招聘自动化、候选人管理、批量消息发送与 AI Agent 集成实践。',
  alternates: {
    canonical: `${SITE_URL}/blog`,
  },
  openGraph: {
    type: 'website',
    url: `${SITE_URL}/blog`,
    title: '博客 | boss-cli',
    description:
      'boss-cli 博客：Boss直聘招聘自动化、候选人管理、批量消息发送与 AI Agent 集成实践。',
    locale: 'zh_CN',
  },
}

export default function BlogIndexPage() {
  const posts = getAllBlogPosts()

  return (
    <div className="bg-slate-950 min-h-screen">
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 pt-28 pb-16">
        <h1 className="text-3xl font-bold text-white mb-3">博客</h1>
        <p className="text-slate-400 mb-10">Boss直聘招聘自动化教程、HR 效率技巧与产品实践。</p>

        {posts.length === 0 ? (
          <p className="text-slate-500">暂无文章。</p>
        ) : (
          <ul className="space-y-4">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/blog/${post.slug}`}
                  className="block rounded-lg border border-slate-800 p-5 transition-colors hover:border-slate-700"
                >
                  {post.date ? <time className="text-xs text-slate-500">{post.date}</time> : null}
                  <h2 className="mt-2 text-xl font-semibold text-white">{post.title}</h2>
                  {post.description ? (
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{post.description}</p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </div>
  )
}
