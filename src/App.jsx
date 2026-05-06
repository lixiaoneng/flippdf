import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Maximize2, Minimize2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

const BOOK_URL = `${import.meta.env.BASE_URL}book/book.pdf`
const COVER_URL = `${import.meta.env.BASE_URL}book/cover.jpg`
const DEFAULT_TITLE = '绘本展示版'
const TURN_DURATION = 500

function getDisplayTitle() {
  const params = new URLSearchParams(window.location.search)
  return params.get('title')?.trim() || DEFAULT_TITLE
}

function App() {
  const pageCacheRef = useRef(new Map())
  const pageWrapRef = useRef(null)
  const renderTaskRef = useRef(null)
  const touchStartRef = useRef(null)
  const turnTimerRef = useRef(null)

  const [title] = useState(getDisplayTitle)
  const [pdfDoc, setPdfDoc] = useState(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isRendering, setIsRendering] = useState(false)
  const [error, setError] = useState('')
  const [hasCover, setHasCover] = useState(false)
  const [showCover, setShowCover] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isTurning, setIsTurning] = useState(false)
  const [currentSpreadImage, setCurrentSpreadImage] = useState(null)
  const [flipAnimation, setFlipAnimation] = useState(null)

  const isCoverVisible = hasCover && showCover
  const canGoPrev = !isCoverVisible && !isTurning && pageNumber > 1
  const canGoNext = !isCoverVisible && !isTurning && pageNumber < totalPages

  const pageLabel = useMemo(() => {
    if (isCoverVisible) return '封面'
    if (!totalPages) return '- / -'
    return `${pageNumber} / ${totalPages}`
  }, [isCoverVisible, pageNumber, totalPages])

  useEffect(() => {
    const image = new Image()
    image.onload = () => {
      setHasCover(true)
      setShowCover(true)
    }
    image.onerror = () => {
      setHasCover(false)
      setShowCover(false)
    }
    image.src = `${COVER_URL}?check=${Date.now()}`
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadPdf() {
      try {
        setIsLoading(true)
        setError('')
        const loadingTask = pdfjsLib.getDocument(BOOK_URL)
        const loadedPdf = await loadingTask.promise
        if (cancelled) return
        setPdfDoc(loadedPdf)
        setTotalPages(loadedPdf.numPages)
      } catch {
        if (!cancelled) {
          setError('PDF 加载失败，请确认 public/book/book.pdf 文件存在且可正常访问。')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadPdf()

    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
    }
  }, [])

  const getViewportBounds = useCallback(() => {
    const container = pageWrapRef.current
    return {
      height: Math.max((container?.clientHeight || window.innerHeight) - 4, 260),
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      width: Math.max((container?.clientWidth || window.innerWidth) - 4, 280),
    }
  }, [])

  const renderPdfPage = useCallback(
    async (targetPage, { trackTask = false, showHint = false } = {}) => {
      if (!pdfDoc) return null

      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d', { alpha: false })

      if (trackTask) renderTaskRef.current?.cancel()
      if (showHint) setIsRendering(true)

      try {
        const page = await pdfDoc.getPage(targetPage)
        const baseViewport = page.getViewport({ scale: 1 })
        const bounds = getViewportBounds()
        const fitScale = Math.min(
          bounds.width / baseViewport.width,
          bounds.height / baseViewport.height,
        )
        const viewport = page.getViewport({ scale: fitScale * bounds.pixelRatio })

        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)

        const task = page.render({ canvasContext: context, viewport })
        if (trackTask) renderTaskRef.current = task
        await task.promise

        return {
          height: Math.floor(viewport.height / bounds.pixelRatio),
          src: canvas.toDataURL('image/jpeg', 0.94),
          width: Math.floor(viewport.width / bounds.pixelRatio),
        }
      } catch (renderError) {
        if (renderError?.name !== 'RenderingCancelledException') {
          setError('页面渲染失败，请刷新后重试。')
        }
        return null
      } finally {
        if (showHint) setIsRendering(false)
      }
    },
    [getViewportBounds, pdfDoc],
  )

  const getPageImage = useCallback(
    async (targetPage) => {
      if (pageCacheRef.current.has(targetPage)) {
        return pageCacheRef.current.get(targetPage)
      }

      const image = await renderPdfPage(targetPage)
      if (image) pageCacheRef.current.set(targetPage, image)
      return image
    },
    [renderPdfPage],
  )

  const renderPage = useCallback(async () => {
    if (!pdfDoc || isCoverVisible || isTurning) return

    const image = await renderPdfPage(pageNumber, {
      showHint: !currentSpreadImage,
      trackTask: true,
    })

    if (image) {
      pageCacheRef.current.set(pageNumber, image)
      setCurrentSpreadImage(image)
    }
  }, [currentSpreadImage, isCoverVisible, isTurning, pageNumber, pdfDoc, renderPdfPage])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => renderPage())
    return () => window.cancelAnimationFrame(frame)
  }, [renderPage])

  useEffect(() => {
    if (!pdfDoc || isCoverVisible) return undefined

    const onResize = () => {
      if (isTurning) return
      pageCacheRef.current.clear()
      setCurrentSpreadImage(null)
      renderPage()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [isCoverVisible, isTurning, pdfDoc, renderPage])

  useEffect(() => {
    return () => window.clearTimeout(turnTimerRef.current)
  }, [])

  const startReading = useCallback(() => {
    if (isTurning) return
    setShowCover(false)
    setPageNumber(1)
  }, [isTurning])

  const turnToPage = useCallback(
    async (targetPage, flipDirection) => {
      if (
        isTurning ||
        isCoverVisible ||
        !pdfDoc ||
        targetPage < 1 ||
        targetPage > totalPages ||
        targetPage === pageNumber ||
        !currentSpreadImage
      ) {
        return
      }

      setIsTurning(true)
      setError('')

      const nextSpreadImage =
        flipDirection === 'next' ? await getPageImage(targetPage) : null
      const prevSpreadImage =
        flipDirection === 'prev' ? await getPageImage(targetPage) : null
      const targetSpreadImage = nextSpreadImage || prevSpreadImage

      if (!targetSpreadImage) {
        setIsTurning(false)
        return
      }

      const frontHalf = flipDirection === 'next' ? 'right' : 'left'
      const backHalf = flipDirection === 'next' ? 'left' : 'right'

      setFlipAnimation({
        backHalf,
        currentSpreadImage,
        flipDirection,
        frontHalf,
        nextSpreadImage,
        phase: 'ready',
        prevSpreadImage,
        targetSpreadImage,
      })

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          setFlipAnimation((effect) =>
            effect ? { ...effect, phase: 'running' } : effect,
          )
        })
      })

      window.clearTimeout(turnTimerRef.current)
      turnTimerRef.current = window.setTimeout(() => {
        setCurrentSpreadImage(targetSpreadImage)
        setPageNumber(targetPage)
        setFlipAnimation(null)
        setIsTurning(false)
      }, TURN_DURATION + 70)
    },
    [
      currentSpreadImage,
      getPageImage,
      isCoverVisible,
      isTurning,
      pageNumber,
      pdfDoc,
      totalPages,
    ],
  )

  const goPrev = useCallback(() => {
    if (pageNumber <= 1) return
    turnToPage(pageNumber - 1, 'prev')
  }, [pageNumber, turnToPage])

  const goNext = useCallback(() => {
    if (pageNumber >= totalPages) return
    turnToPage(pageNumber + 1, 'next')
  }, [pageNumber, totalPages, turnToPage])

  useEffect(() => {
    const onKeyDown = (event) => {
      if (isTurning) return
      if (event.key === 'ArrowLeft') goPrev()
      if (event.key === 'ArrowRight') {
        if (isCoverVisible) startReading()
        else goNext()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [goNext, goPrev, isCoverVisible, isTurning, startReading])

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement))
      window.setTimeout(renderPage, 80)
    }

    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [renderPage])

  useEffect(() => {
    const preventDefault = (event) => event.preventDefault()
    document.addEventListener('contextmenu', preventDefault)
    document.addEventListener('dragstart', preventDefault)
    return () => {
      document.removeEventListener('contextmenu', preventDefault)
      document.removeEventListener('dragstart', preventDefault)
    }
  }, [])

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen?.()
    } else {
      await document.exitFullscreen?.()
    }
  }

  const handleTouchStart = (event) => {
    if (event.touches.length !== 1) {
      touchStartRef.current = null
      return
    }

    const touch = event.changedTouches[0]
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
    }
  }

  const handleTouchEnd = (event) => {
    const start = touchStartRef.current
    if (!start || isTurning || event.touches.length > 0) return

    const touch = event.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    touchStartRef.current = null

    if (Math.abs(deltaX) < 46 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return
    if (deltaX < 0) {
      if (isCoverVisible) startReading()
      else goNext()
    } else {
      goPrev()
    }
  }

  return (
    <main
      className="reader-shell"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <header className="reader-topbar" aria-label="阅读工具栏">
        <div className="brand-title">{title}</div>
        <div className="reader-meta" aria-label="当前页码">
          {pageLabel}
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? '退出全屏' : '全屏阅读'}
          title={isFullscreen ? '退出全屏' : '全屏阅读'}
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </header>

      <section className="reader-stage" aria-live="polite">
        <div className="watermark" aria-hidden="true" />

        {isLoading && (
          <div className="status-card">
            <span className="loader" aria-hidden="true" />
            <p>正在打开绘本样书</p>
          </div>
        )}

        {!isLoading && error && (
          <div className="status-card status-card--error">
            <p>{error}</p>
          </div>
        )}

        {!isLoading && !error && isCoverVisible && (
          <div className={`cover-panel ${isTurning ? 'cover-panel--leaving' : ''}`}>
            <div className="cover-copy">
              <span>Picture Book Preview</span>
              <h1>{title}</h1>
            </div>
            <img
              className="cover-image"
              src={COVER_URL}
              alt={`${title}封面`}
              draggable="false"
            />
            <button type="button" className="primary-button" onClick={startReading}>
              开始阅读
            </button>
          </div>
        )}

        {!isLoading && !error && !isCoverVisible && (
          <div
            className={`book-stage ${flipAnimation ? 'book-stage--flipping' : ''}`}
            ref={pageWrapRef}
          >
            {isRendering && (
              <div className="rendering-hint">
                <span className="loader loader--small" aria-hidden="true" />
              </div>
            )}
            {(flipAnimation?.targetSpreadImage || currentSpreadImage) && (
              <img
                className="spread-static"
                src={(flipAnimation?.targetSpreadImage || currentSpreadImage).src}
                width={(flipAnimation?.targetSpreadImage || currentSpreadImage).width}
                height={(flipAnimation?.targetSpreadImage || currentSpreadImage).height}
                alt={`第 ${pageNumber} 页，共 ${totalPages} 页`}
                draggable="false"
              />
            )}
            {flipAnimation && (
              <div
                className={`page-flip-layer page-flip-layer--${flipAnimation.flipDirection} page-flip-layer--${flipAnimation.phase}`}
                style={{
                  '--back-spread': `url(${flipAnimation.targetSpreadImage.src})`,
                  '--current-spread': `url(${flipAnimation.currentSpreadImage.src})`,
                  '--spread-height': `${flipAnimation.currentSpreadImage.height}px`,
                  '--spread-width': `${flipAnimation.currentSpreadImage.width}px`,
                }}
                aria-hidden="true"
              >
                <div
                  className={`page-face front page-face--${flipAnimation.frontHalf}`}
                />
                <div
                  className={`page-face back page-face--${flipAnimation.backHalf}`}
                />
              </div>
            )}
          </div>
        )}

        {!isLoading && !error && !isCoverVisible && (
          <>
            <button
              type="button"
              className="page-button page-button--prev"
              onClick={goPrev}
              disabled={!canGoPrev}
              aria-label="上一页"
            >
              <ChevronLeft size={26} />
            </button>
            <button
              type="button"
              className="page-button page-button--next"
              onClick={goNext}
              disabled={!canGoNext}
              aria-label="下一页"
            >
              <ChevronRight size={26} />
            </button>
          </>
        )}
      </section>

      <footer className="reader-footer">
        仅供蒙牛内部领导查看，请勿下载、截图或外传。
      </footer>
    </main>
  )
}

export default App
