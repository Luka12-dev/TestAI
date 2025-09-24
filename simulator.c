#include <stdlib.h>
#include <math.h>
#include <time.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#endif

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static unsigned long long seed_val = 0;

static double rand01() {
    seed_val = seed_val * 6364136223846793005ULL + 1;
    unsigned long long x = seed_val >> 12;
    return (x & 0xFFFFFFFFULL) / (double)0x100000000ULL;
}

void init_seed() {
    seed_val = (unsigned long long)time(NULL) ^ 0xdeadbeefULL;
    if (seed_val == 0) seed_val = 123456789ULL;
}

static double normal01() {
    double u = rand01();
    double v = rand01();
    if (u < 1e-12) u = 1e-12;
    return sqrt(-2.0 * log(u)) * cos(2.0 * M_PI * v);
}

static int cmpd(const void* a, const void* b) {
    double da = *(double*)a;
    double db = *(double*)b;
    if (da < db) return -1;
    if (da > db) return 1;
    return 0;
}

#ifdef __cplusplus
extern "C" {
#endif

#ifdef __EMSCRIPTEN__
EMSCRIPTEN_KEEPALIVE
#endif
void run_simulation(int clients, double rps, int duration,
                    double* out_buf, int max_samples, int* out_written) {
    if (!out_buf || max_samples <= 0 || !out_written) return;
    init_seed();
    int idx = 0;

    for (int t = 0; t < duration && idx < max_samples; ++t) {
        int perSecond = (int)round(clients * rps);
        if (perSecond < 1) perSecond = 1;

        for (int i = 0; i < perSecond && idx < max_samples; ++i) {
            double base = 50.0;
            double jitter = 15.0;
            double spikeChance = 0.05;

            double val = base + normal01() * (jitter / 2.0);
            if (rand01() < spikeChance) val += fabs(normal01()) * jitter * 8.0 + jitter * 2.0;
            if (val < 1.0) val = 1.0;

            out_buf[idx++] = val;
        }
    }

    *out_written = idx;
}

#ifdef __EMSCRIPTEN__
#endif
void compute_metrics_from_buffer(double* buf, int count, double* out_metrics) {
    if (!buf || count <= 0 || !out_metrics) return;

    double sum = 0.0;
    for (int i = 0; i < count; ++i) sum += buf[i];
    double avg = sum / count;

    double* copy = (double*)malloc(sizeof(double) * count);
    if (!copy) {
        out_metrics[0] = avg;
        out_metrics[1] = 0.0;
        out_metrics[2] = 0.0;
        out_metrics[3] = 0.0;
        return;
    }

    for (int i = 0; i < count; ++i) copy[i] = buf[i];
    qsort(copy, count, sizeof(double), cmpd);

    double p50 = copy[(int)floor((count - 1) * 0.5)];
    double p95 = copy[(int)floor((count - 1) * 0.95)];
    double throughput = (double)count;

    out_metrics[0] = avg;
    out_metrics[1] = p50;
    out_metrics[2] = p95;
    out_metrics[3] = throughput;

    free(copy);
}

#ifdef __cplusplus
}
#endif