use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tracing::Event;
use tracing_subscriber::fmt::time::LocalTime;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::Context;
use tracing_subscriber::prelude::*;
use tracing_subscriber::Layer;

const RING_MAX_BYTES: usize = 128 * 1024; // ~300-500 log lines
const MAX_CRASH_FILES: usize = 15;

// ── Ring-backed writer ─────────────────────────────────

/// Always writes to ring buffer; optionally writes to file after activation.
struct RingInner {
    buf: Vec<u8>,
    file: Option<fs::File>,
    log_dir: PathBuf,
}

#[derive(Clone)]
struct RingWriter(Arc<Mutex<RingInner>>);

impl RingWriter {
    fn new(log_dir: PathBuf) -> Self {
        Self(Arc::new(Mutex::new(RingInner {
            buf: Vec::new(),
            file: None,
            log_dir,
        })))
    }

    fn activate_file(&self) {
        let mut inner = self.0.lock().unwrap();
        if inner.file.is_some() {
            return;
        }

        fs::create_dir_all(&inner.log_dir).ok();

        let ts = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S");
        let path = inner.log_dir.join(format!("crash-{}.log", ts));

        if let Ok(mut f) = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            if !inner.buf.is_empty() {
                let header = format!(
                    "=== 崩溃前上下文 ({} 字节) ===\n",
                    inner.buf.len()
                );
                f.write_all(header.as_bytes()).ok();
                f.write_all(&inner.buf).ok();
                f.write_all("\n=== 崩溃时刻 ===\n".as_bytes()).ok();
                f.flush().ok();
            }
            inner.file = Some(f);
        }

        // Purge oldest crash logs beyond limit
        if let Ok(entries) = fs::read_dir(&inner.log_dir) {
            let mut files: Vec<PathBuf> = entries
                .flatten()
                .filter_map(|e| {
                    let p = e.path();
                    let is_crash_log = p.file_name()
                        .and_then(|s| s.to_str())
                        .map_or(false, |n| n.starts_with("crash-") && n.ends_with(".log"));
                    if is_crash_log { Some(p) } else { None }
                })
                .collect();
            files.sort(); // oldest first
            while files.len() > MAX_CRASH_FILES {
                if let Some(old) = files.first() {
                    fs::remove_file(old).ok();
                    files.remove(0);
                }
            }
        }
    }
}

// RingWriter implements Write via the shared ring buffer.
impl Write for RingWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut inner = self.0.lock().unwrap();

        // Ring buffer: trim oldest lines when over capacity
        inner.buf.extend_from_slice(buf);
        while inner.buf.len() > RING_MAX_BYTES {
            if let Some(pos) = inner.buf.iter().position(|&b| b == b'\n') {
                inner.buf.drain(..=pos);
            } else {
                inner.buf.clear();
                break;
            }
        }

        // Mirror to crash file if active
        if let Some(ref mut f) = inner.file {
            f.write_all(buf)?;
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        if let Some(ref mut f) = self.0.lock().unwrap().file {
            f.flush()?;
        }
        Ok(())
    }
}

// RingWriter is a valid MakeWriter: each call to make_writer() returns a
// clone that shares the same Arc<Mutex<RingInner>>.
impl<'a> MakeWriter<'a> for RingWriter {
    type Writer = RingWriter;
    fn make_writer(&self) -> Self::Writer {
        self.clone()
    }
}

// ── Error-triggering layer ─────────────────────────────

struct ErrorTrigger {
    writer: RingWriter,
    triggered: AtomicBool,
}

impl<S: tracing::Subscriber> Layer<S> for ErrorTrigger {
    fn on_event(&self, event: &Event<'_>, _ctx: Context<'_, S>) {
        if *event.metadata().level() <= tracing::Level::ERROR
            && !self.triggered.swap(true, Ordering::SeqCst)
        {
            self.writer.activate_file();
        }
    }
}

// ── Global handle for panic hook ───────────────────────

static TRIGGER: std::sync::LazyLock<Mutex<Option<RingWriter>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

// ── Public API ─────────────────────────────────────────

/// Initialize logging.
/// - Console output (stderr) always active
/// - Ring buffer holds last ~300 lines in memory
/// - On first ERROR event or panic → dump buffer to `logs/crash-{timestamp}.log`
pub fn init(data_dir: PathBuf) {
    // Forward log crate macros (log::info!, etc.) to tracing subscriber
    tracing_log::LogTracer::init().ok();

    let log_dir = data_dir.join("logs");
    let writer = RingWriter::new(log_dir);

    let console_layer = tracing_subscriber::fmt::layer()
        .with_timer(LocalTime::rfc_3339())
        .with_target(true)
        .with_writer(std::io::stderr);

    let ring_layer = tracing_subscriber::fmt::layer()
        .with_timer(LocalTime::rfc_3339())
        .with_target(true)
        .with_ansi(false)
        .with_writer(writer.clone());

    let trigger = ErrorTrigger {
        writer: writer.clone(),
        triggered: AtomicBool::new(false),
    };

    // trigger goes first → activates file BEFORE ring_layer writes the event
    let subscriber = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with(trigger)
        .with(ring_layer)
        .with(console_layer);

    tracing::subscriber::set_global_default(subscriber)
        .expect("Failed to set global tracing subscriber");

    // Save for panic hook
    *TRIGGER.lock().unwrap() = Some(writer);
}

/// Register a panic hook that dumps the ring buffer to a crash log.
pub fn set_panic_hook() {
    let old_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        // Activate file via the stored handle
        if let Some(ref w) = *TRIGGER.lock().unwrap() {
            w.activate_file();
        }
        // Log the panic — this will go to file + ring buffer
        log::error!("!!! PANIC !!! {}", info);
        old_hook(info);
    }));
}
