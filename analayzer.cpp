#include <cmath>
#include <cstdlib>

extern "C" {

int detect_anomalies(double* buf, int count, double multiplier, int* out_indices, int max_out) {
    if (!buf || count <= 0 || !out_indices || max_out <= 0) return 0;
    double sum = 0.0;
    for (int i = 0; i < count; ++i) sum += buf[i];
    double mean = sum / count;
    double threshold = mean * multiplier;
    int written = 0;
    for (int i = 0; i < count && written < max_out; ++i) {
        if (buf[i] > threshold) {
            out_indices[written++] = i;
        }
    }
    return written;
}

}