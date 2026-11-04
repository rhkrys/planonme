/** Short steps for saving slides as a PDF in the tools people use most. */
export function SlideHelp() {
  return (
    <details className="slide-help">
      <summary>How to save your slides as a PDF</summary>
      <div className="slide-help-body">
        <section aria-labelledby="help-pptx">
          <h3 id="help-pptx">PowerPoint</h3>
          <ul>
            <li>
              Windows: <b>File</b>, <b>Export</b>, <b>Create PDF/XPS Document</b>, then{' '}
              <b>Publish</b>.
            </li>
            <li>
              Mac: <b>File</b>, <b>Export</b>, set <b>File Format</b> to <b>PDF</b>, then{' '}
              <b>Export</b>.
            </li>
            <li>
              On the web: <b>File</b>, <b>Export</b>, then <b>Download as PDF</b>.
            </li>
          </ul>
        </section>
        <section aria-labelledby="help-gslides">
          <h3 id="help-gslides">Google Slides</h3>
          <ul>
            <li>
              <b>File</b>, <b>Download</b>, then <b>PDF document (.pdf)</b>.
            </li>
          </ul>
        </section>
        <section aria-labelledby="help-canva">
          <h3 id="help-canva">Canva</h3>
          <ul>
            <li>
              <b>Share</b>, <b>Download</b>, set <b>File type</b> to <b>PDF Standard</b>, then{' '}
              <b>Download</b>.
            </li>
          </ul>
        </section>
        <section aria-labelledby="help-gamma">
          <h3 id="help-gamma">Gamma</h3>
          <ul>
            <li>
              Open the menu at the top right (<b>...</b>), choose <b>Export</b>, then{' '}
              <b>Export to PDF</b>.
            </li>
            <li>
              Long cards may be split over more than one page. Check the PDF before you import.
            </li>
          </ul>
        </section>
        <p className="muted">
          Each page becomes one slide image. Animations, transitions, videos and speaker notes do
          not carry over. Slides in 16:9 fill a shared Zoom window best.
        </p>
      </div>
    </details>
  )
}
