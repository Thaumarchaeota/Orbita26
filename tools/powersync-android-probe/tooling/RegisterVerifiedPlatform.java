import com.android.repository.Revision;
import com.android.repository.api.Checksum;
import com.android.repository.api.License;
import com.android.repository.api.LocalPackage;
import com.android.repository.api.ProgressIndicator;
import com.android.repository.api.RemotePackage;
import com.android.repository.api.RepoManager;
import com.android.repository.api.RepoPackage;
import com.android.repository.api.Repository;
import com.android.repository.api.SchemaModule;
import com.android.repository.impl.meta.Archive;
import com.android.repository.impl.meta.SchemaModuleUtil;
import com.android.repository.util.InstallerUtil;
import com.android.sdklib.repository.AndroidSdkHandler;
import com.android.sdklib.repository.meta.DetailsTypes;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipFile;

/**
 * Register one checksum-verified, already extracted platform using Google's serializer, not an
 * SDK-manager installation or license acceptance. See README and the second-stage D plan.
 * No CLI paths, downloads, package-manager load/refresh, deletion, or source.properties edits.
 */
public final class RegisterVerifiedPlatform {
    private static final String PACKAGE = "platforms;android-37.0";
    private static final String ZIP_NAME = "platform-37.0_r02.zip";
    private static final String ZIP_SHA1 = "ed8ebf7f8822a4de5686d427f237d2fa30ff7410";
    private static final long ZIP_SIZE = 67_281_901L;
    private static final String ZIP_PREFIX = "android-37.0/";
    private static final Path EXISTING_LICENSE_ROOT = Path.of("D:\\programs\\Android\\Sdk");
    private static final LinkOption NOFOLLOW = LinkOption.NOFOLLOW_LINKS;

    public static void main(String[] args) throws Exception {
        require(args.length == 0, "This helper accepts no arguments");
        // Anchor paths to the one prescribed local compiler-output directory, independent of cwd.
        Path classes = Path.of(RegisterVerifiedPlatform.class.getProtectionDomain()
                .getCodeSource().getLocation().toURI()).toAbsolutePath().normalize();
        require(Runtime.version().feature() == 17 && classes.getClass().getName().equals("sun.nio.fs.WindowsPath"),
                "This reviewed helper requires the Windows JDK17 default filesystem provider");
        require(classes.getFileName().toString().equals("register-platform-classes"), "Unexpected class output directory");
        Path local = classes.getParent();
        require(local.getFileName().toString().equals("local"), "Compiler output must remain under local");
        Path project = local.getParent();
        require(project.getFileName().toString().equals("powersync-android-probe")
                && project.getParent().getFileName().toString().equals("tools"), "Unexpected isolated project");
        existing(classes, true);
        existing(project.resolve("tooling/RegisterVerifiedPlatform.java"), false);
        Path sdk = local.resolve("sdk");
        Path platform = sdk.resolve("platforms/android-37.0");
        Path archive = local.resolve("downloads").resolve(ZIP_NAME);
        Path repositoryXml = local.resolve("downloads/repository2-3.xml");
        existing(platform, true);
        existing(archive, false);
        existing(repositoryXml, false);
        Path target = platform.resolve("package.xml");
        require(!Files.exists(target, NOFOLLOW), "Target package.xml already exists; refusing overwrite");
        require(Files.size(archive) == ZIP_SIZE && hash(archive, "SHA-1").equals(ZIP_SHA1), "Archive size/SHA1 mismatch");

        StrictProgress progress = new StrictProgress();
        List<SchemaModule<?>> modules = List.of(RepoManager.getCommonModule(), RepoManager.getGenericModule(),
                AndroidSdkHandler.getCommonModule(), AndroidSdkHandler.getRepositoryModule());
        // No AndroidSdkHandler instance, global SDK discovery, source provider, fallback, or load call.
        RepoManager manager = RepoManager.createRepoManager(sdk, modules, List.of(), null, null);
        Repository repository = parse(readBounded(repositoryXml, 32L * 1024 * 1024), modules, progress, "official downloaded repository XML");
        List<? extends RemotePackage> matching = repository.getRemotePackage().stream()
                .filter(p -> PACKAGE.equals(p.getPath())).toList();
        require(matching.size() == 1, "Expected exactly one official platform entry");
        RemotePackage remote = matching.get(0);
        validateIdentity(remote);
        Archive selected = remote.getArchive();
        require(selected != null, "Missing compatible official archive");
        Archive.CompleteType complete = selected.getComplete();
        Checksum checksum = complete.getTypedChecksum();
        require(ZIP_NAME.equals(complete.getUrl()) && complete.getSize() == ZIP_SIZE
                && "sha1".equals(checksum.getType().toLowerCase(Locale.ROOT).replace("-", ""))
                && ZIP_SHA1.equals(checksum.getValue().toLowerCase(Locale.ROOT)), "Official archive reference differs");
        License license = remote.getLicense();
        require(license != null && "android-sdk-license".equals(license.getId()), "Unexpected license reference");
        existing(EXISTING_LICENSE_ROOT.resolve("licenses/android-sdk-license"), false);
        // Read-only confirmation of the SAME parsed official terms. Never setAccepted or copy hashes.
        require(license.checkAccepted(EXISTING_LICENSE_ROOT), "Same official license not already accepted; stopping");
        progress.requireClean();
        int verifiedFiles = verifyExtracted(archive, platform);

        Path stage = local.resolve("platform-registration-" + UUID.randomUUID());
        require(!Files.exists(stage, NOFOLLOW), "Stage already exists");
        Files.createDirectory(stage);
        existing(stage, true);
        // Official remote-to-local serializer; never hand-construct or patch XML/version attributes.
        InstallerUtil.writePackageXml(remote, stage, manager, progress);
        progress.requireClean(); // marshal may log rather than throw, so warnings/errors are fatal.
        Path stagedMetadata = stage.resolve("package.xml");
        byte[] serialized = readBounded(stagedMetadata, 1024 * 1024);
        validateLocal(parse(serialized, modules, progress, "staged official package metadata"), remote, license);
        progress.requireClean();
        require(Files.size(archive) == ZIP_SIZE && hash(archive, "SHA-1").equals(ZIP_SHA1), "Archive changed during verification");
        existing(platform, true);
        require(!Files.exists(target, NOFOLLOW), "Target appeared during verification; refusing overwrite");
        try (FileChannel channel = FileChannel.open(target, StandardOpenOption.CREATE_NEW,
                StandardOpenOption.WRITE, NOFOLLOW)) {
            ByteBuffer buffer = ByteBuffer.wrap(serialized);
            while (buffer.hasRemaining()) channel.write(buffer);
            channel.force(true);
        }
        byte[] reread = readBounded(target, 1024 * 1024);
        require(Arrays.equals(serialized, reread), "Persisted metadata bytes differ");
        validateLocal(parse(reread, modules, progress, "persisted official package metadata"), remote, license);
        progress.requireClean();
        System.out.println("REGISTERED OFFICIAL METADATA ONLY: " + PACKAGE + " revision=2 api=37.0"
                + " archiveSha1=" + ZIP_SHA1 + " verifiedFiles=" + verifiedFiles
                + " metadataSha256=" + digest(reread, "SHA-256")
                + "; existing license checked read-only; no installation/license acceptance/AGP validation performed.");
        // Stage and any failure artifacts remain for review; no cleanup or retry path.
    }

    private static Repository parse(byte[] bytes, List<SchemaModule<?>> modules,
            StrictProgress progress, String description) throws Exception {
        Object parsed = SchemaModuleUtil.unmarshal(new ByteArrayInputStream(bytes), modules, true, progress, description);
        progress.requireClean();
        require(parsed instanceof Repository, "Wrong repository document type");
        return (Repository) parsed;
    }

    private static void validateIdentity(RepoPackage p) {
        require(PACKAGE.equals(p.getPath()) && new Revision(2).equals(p.getVersion()), "Package identity/revision differs");
        require(p.getTypeDetails() instanceof DetailsTypes.PlatformDetailsType, "Not platform details");
        DetailsTypes.PlatformDetailsType d = (DetailsTypes.PlatformDetailsType) p.getTypeDetails();
        require("37.0".equals(d.getApiLevelString()) && d.getApiLevel() == 37 && d.getApiMinorLevel() == 0
                && d.isBaseExtension() && Integer.valueOf(22).equals(d.getExtensionLevel())
                && (d.getCodename() == null || d.getCodename().isEmpty()), "Platform API details differ");
    }

    private static void validateLocal(Repository parsed, RemotePackage remote, License license) {
        require(parsed.getRemotePackage().isEmpty(), "Local metadata contains remote packages");
        LocalPackage local = parsed.getLocalPackage();
        require(local != null, "No generated local package");
        validateIdentity(local);
        require(Objects.equals(local.getDisplayName(), remote.getDisplayName()), "Display name differs");
        License after = local.getLicense();
        require(after != null && after.getId().equals(license.getId())
                && after.getValue().equals(license.getValue()) && Objects.equals(after.getType(), license.getType())
                && after.getLicenseHash().equals(license.getLicenseHash()), "Generated license differs");
        require(parsed.getLicense().size() == 1
                && parsed.getLicense().get(0).getLicenseHash().equals(license.getLicenseHash()), "License document differs");
    }

    private static int verifyExtracted(Path archive, Path platform) throws Exception {
        Map<String, Boolean> expected = new HashMap<>();
        Set<String> caseFolded = new HashSet<>();
        long total = 0;
        int entries = 0;
        int files = 0;
        try (ZipFile zip = new ZipFile(archive.toFile())) {
            Enumeration<ZipArchiveEntry> all = zip.getEntries();
            while (all.hasMoreElements()) {
                ZipArchiveEntry entry = all.nextElement();
                require(++entries <= 20_000, "Archive entry limit exceeded");
                String name = entry.getName();
                require(name.startsWith(ZIP_PREFIX) && !name.contains("\\") && !name.contains("\u0000"), "Archive path outside platform");
                require(caseFolded.add(name.toLowerCase(Locale.ROOT)), "Duplicate/case-alias archive entry");
                int type = entry.getUnixMode() & 0170000;
                require(!entry.isUnixSymlink() && (type == 0 || type == 0100000 || type == 0040000)
                        && (entry.getExternalAttributes() & 0x400L) == 0
                        && !entry.getGeneralPurposeBit().usesEncryption(), "Unsupported/reparse/encrypted ZIP entry");
                String relative = name.substring(ZIP_PREFIX.length());
                if (relative.isEmpty()) { require(entry.isDirectory(), "Invalid ZIP root"); continue; }
                if (entry.isDirectory()) relative = relative.substring(0, relative.length() - 1);
                for (String segment : relative.split("/", -1)) {
                    require(!segment.isEmpty() && !segment.equals(".") && !segment.equals("..")
                            && !segment.matches(".*[<>:\"|?*].*") && !segment.endsWith(".") && !segment.endsWith(" "), "Unsafe ZIP segment");
                }
                Path destination = platform.resolve(relative).normalize();
                require(destination.startsWith(platform) && !destination.equals(platform), "ZIP path escapes root");
                putExpected(expected, relative, entry.isDirectory());
                Path parent = Path.of(relative).getParent();
                while (parent != null) {
                    putExpected(expected, slash(parent), true);
                    parent = parent.getParent();
                }
                existing(destination, entry.isDirectory());
                if (!entry.isDirectory()) {
                    require(entry.getSize() >= 0 && entry.getSize() <= 256L * 1024 * 1024, "ZIP member size invalid");
                    total = Math.addExact(total, entry.getSize());
                    require(total <= 2L * 1024 * 1024 * 1024 && Files.size(destination) == entry.getSize(), "Expanded platform size differs");
                    try (InputStream original = zip.getInputStream(entry)) {
                        require(hashStream(original, "SHA-256", entry.getSize()).equals(hash(destination, "SHA-256")), "Extracted member content differs: " + relative);
                    }
                    files++;
                }
            }
        }
        require(files > 0 && expected.containsKey("android.jar") && expected.containsKey("source.properties"), "Incomplete platform ZIP");
        Set<String> actual = new HashSet<>();
        Files.walkFileTree(platform, new SimpleFileVisitor<Path>() {
            @Override public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) throws IOException {
                existing(dir, true);
                if (!dir.equals(platform)) visit(dir, true);
                return FileVisitResult.CONTINUE;
            }
            @Override public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                existing(file, false);
                visit(file, false);
                return FileVisitResult.CONTINUE;
            }
            private void visit(Path path, boolean directory) {
                String relative = slash(platform.relativize(path));
                require(expected.containsKey(relative) && expected.get(relative) == directory, "Extra or wrong-kind extracted entry: " + relative);
                require(actual.add(relative), "Duplicate extracted path");
            }
        });
        require(actual.equals(expected.keySet()), "Missing extracted entries");
        return files;
    }

    private static void putExpected(Map<String, Boolean> expected, String path, boolean directory) {
        Boolean old = expected.putIfAbsent(path, directory);
        require(old == null || old == directory, "Conflicting ZIP path kinds");
    }

    private static String slash(Path path) { return path.toString().replace('\\', '/'); }

    private static void existing(Path path, boolean directory) throws IOException {
        Path absolute = path.toAbsolutePath().normalize();
        Path cursor = absolute.getRoot();
        for (Path segment : absolute) {
            cursor = cursor.resolve(segment);
            BasicFileAttributes attrs = Files.readAttributes(cursor, BasicFileAttributes.class, NOFOLLOW);
            // JDK17 WindowsFileAttributes.isOther includes every FILE_ATTRIBUTE_REPARSE_POINT.
            // https://github.com/openjdk/jdk17u/blob/master/src/java.base/windows/classes/sun/nio/fs/WindowsFileAttributes.java
            // NOFOLLOW plus per-component checks also cover junctions; realpath rejects redirects.
            require(!attrs.isSymbolicLink() && !attrs.isOther(), "Symlink/reparse/other path refused");
            require(cursor.toRealPath().equals(cursor), "Redirected path refused");
        }
        BasicFileAttributes attrs = Files.readAttributes(absolute, BasicFileAttributes.class, NOFOLLOW);
        require(directory ? attrs.isDirectory() : attrs.isRegularFile(), "Unexpected path kind");
    }

    private static byte[] readBounded(Path path, long max) throws IOException {
        existing(path, false);
        long size = Files.size(path);
        require(size > 0 && size <= max, "Missing/oversized XML");
        try (InputStream input = Files.newInputStream(path, NOFOLLOW)) {
            byte[] bytes = input.readNBytes(Math.toIntExact(max + 1));
            require(bytes.length == size, "XML changed or exceeded bound");
            return bytes;
        }
    }

    private static String hash(Path path, String algorithm) throws Exception {
        existing(path, false);
        long size = Files.size(path);
        try (InputStream input = Files.newInputStream(path, NOFOLLOW)) { return hashStream(input, algorithm, size); }
    }

    private static String hashStream(InputStream input, String algorithm, long expected) throws Exception {
        MessageDigest digest = MessageDigest.getInstance(algorithm);
        byte[] buffer = new byte[64 * 1024];
        long count = 0;
        for (int read; (read = input.read(buffer)) != -1;) {
            count += read;
            require(count <= expected, "Stream exceeded expected size");
            digest.update(buffer, 0, read);
        }
        require(count == expected, "Stream size differs");
        return HexFormat.of().formatHex(digest.digest());
    }

    private static String digest(byte[] bytes, String algorithm) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance(algorithm).digest(bytes));
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalStateException(message);
    }

    private static final class StrictProgress implements ProgressIndicator {
        private final List<String> problems = new ArrayList<>();
        private boolean canceled;
        private boolean cancellable;
        private boolean indeterminate;
        private double fraction;
        void requireClean() { require(problems.isEmpty(), "Official parser/serializer reported: " + problems); }
        private void problem(String message) { problems.add(message.substring(0, Math.min(240, message.length()))); }
        @Override public void logWarning(String message) { problem(message); }
        @Override public void logWarning(String message, Throwable error) { problem(message); }
        @Override public void logError(String message) { problem(message); }
        @Override public void logError(String message, Throwable error) { problem(message); }
        @Override public void logInfo(String message) { }
        @Override public void logVerbose(String message) { }
        @Override public void setText(String text) { }
        @Override public void setSecondaryText(String text) { }
        @Override public boolean isCanceled() { return canceled; }
        @Override public void cancel() { canceled = true; }
        @Override public void setCancellable(boolean value) { cancellable = value; }
        @Override public boolean isCancellable() { return cancellable; }
        @Override public void setIndeterminate(boolean value) { indeterminate = value; }
        @Override public boolean isIndeterminate() { return indeterminate; }
        @Override public void setFraction(double value) { fraction = value; }
        @Override public double getFraction() { return fraction; }
    }
}
