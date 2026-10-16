#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) return 2;
    NSURL *input = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
    NSURL *output = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[2]]];
    AVAssetExportSession *exporter = [[AVAssetExportSession alloc]
      initWithAsset:[AVURLAsset URLAssetWithURL:input options:nil]
      presetName:AVAssetExportPresetAppleM4A];
    if (!exporter) return 3;
    exporter.outputURL = output;
    exporter.outputFileType = AVFileTypeAppleM4A;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    [exporter exportAsynchronouslyWithCompletionHandler:^{ dispatch_semaphore_signal(done); }];
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    if (exporter.status != AVAssetExportSessionStatusCompleted) {
      fprintf(stderr, "%s\n", exporter.error.localizedDescription.UTF8String);
      return 1;
    }
  }
  return 0;
}
