import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from "react-native";
import { useRouter } from "expo-router";
import { createUserWithEmailAndPassword, deleteUser, signOut } from "firebase/auth";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth } from "@/config/firebase";
import { ensureUserProfile, isUsernameTaken } from "@/hooks/useProfile";
import { useAuthStore } from "@/store/authStore";
import { COLORS, SPACING, RADIUS, FONTS, ATHLETE_TYPES } from "@/constants/theme";
import GlowButton from "@/components/GlowButton";

function authErrorMessage(code: string): string {
  switch (code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists.";
    case "auth/weak-password":
      return "Use at least 6 characters for your password.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/network-request-failed":
      return "Check your connection and try again.";
    default:
      return "Unable to create account. Please try again.";
  }
}

export default function RegisterScreen() {
  const router = useRouter();
  const setProfile = useAuthStore((s) => s.setProfile);
  const setUserId = useAuthStore((s) => s.setUserId);

  const [step, setStep] = useState<"credentials" | "profile">("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [username, setUsername] = useState("");
  const [athleteType, setAthleteType] = useState<string>("");
  const [bio, setBio] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleCredentials() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !password) {
      setError("Email and password are required.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setError("Enter a valid email address.");
      return;
    }
    setStep("profile");
    setError("");
  }

  async function handleSignUp() {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedUser = username.trim();

    if (!trimmedUser || trimmedUser.length < 3) {
      setError("Username is required.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const cred = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
      const usernameTaken = await isUsernameTaken(trimmedUser, cred.user.uid);
      if (usernameTaken) {
        await deleteUser(cred.user).catch(() => signOut(auth));
        setError("That username is already taken.");
        return;
      }
      const profile = await ensureUserProfile(
        cred.user.uid,
        trimmedUser,
        athleteType || "Other",
        "",
        bio.trim()
      );
      setUserId(cred.user.uid);
      setProfile(profile);
      // AuthGuard handles redirect
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      setError(authErrorMessage(code));
      setStep("credentials");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          {/* Back button */}
          <Pressable onPress={() => {
            if (step === "profile") setStep("credentials");
            else router.back();
          }} style={styles.backBtn}>
            <Text style={styles.backText}>← Back</Text>
          </Pressable>

          <Text style={styles.heading}>
            {step === "credentials" ? "Create account" : "Athlete setup"}
          </Text>
          <Text style={styles.subheading}>
            {step === "credentials"
              ? "One minute. Then you're in."
              : "Build your player card."}
          </Text>

          {step === "credentials" ? (
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="emailAddress"
                value={email}
                onChangeText={(t) => { setEmail(t); setError(""); }}
                editable={!loading}
              />
              <TextInput
                style={styles.input}
                placeholder="Password (min 6 chars)"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                textContentType="newPassword"
                value={password}
                onChangeText={(t) => { setPassword(t); setError(""); }}
                editable={!loading}
              />
              <TextInput
                style={styles.input}
                placeholder="Confirm password"
                placeholderTextColor={COLORS.textMuted}
                secureTextEntry
                textContentType="newPassword"
                value={confirmPassword}
                onChangeText={(t) => { setConfirmPassword(t); setError(""); }}
                editable={!loading}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <GlowButton
                label="Continue"
                onPress={handleCredentials}
                disabled={loading}
                size="lg"
                style={styles.btn}
              />
            </View>
          ) : (
            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor={COLORS.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                value={username}
                onChangeText={(t) => { setUsername(t); setError(""); }}
                editable={!loading}
              />

              <Text style={styles.sectionLabel}>Sport</Text>
              <View style={styles.chipGrid}>
                {ATHLETE_TYPES.map((type) => (
                  <Pressable
                    key={type}
                    style={[
                      styles.chip,
                      athleteType === type && styles.chipActive,
                    ]}
                    onPress={() => setAthleteType(type)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        athleteType === type && styles.chipTextActive,
                      ]}
                    >
                      {type}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <TextInput
                style={[styles.input, styles.bioInput]}
                placeholder="Bio (optional)"
                placeholderTextColor={COLORS.textMuted}
                multiline
                maxLength={160}
                value={bio}
                onChangeText={(t) => { setBio(t); setError(""); }}
                editable={!loading}
              />

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={styles.buttonRow}>
                <GlowButton
                  label="Back"
                  onPress={() => setStep("credentials")}
                  disabled={loading}
                  variant="secondary"
                  size="lg"
                  style={styles.rowBtn}
                />
              <GlowButton
                label="Continue"
                onPress={handleSignUp}
                loading={loading}
                disabled={loading}
                size="lg"
                style={styles.rowBtn}
              />
              </View>
            </View>
          )}

          {step === "credentials" && (
            <Pressable onPress={() => router.back()} style={styles.switchRow}>
              <Text style={styles.switchText}>
                Have an account?{" "}
                <Text style={styles.switchLink}>Sign in →</Text>
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  scroll: {
    flexGrow: 1,
    padding: SPACING.xl,
    paddingTop: SPACING.lg,
  },
  backBtn: { marginBottom: SPACING.xl },
  backText: { color: COLORS.textMuted, fontSize: 14 },
  heading: {
    color: COLORS.textPrimary,
    fontSize: 28,
    fontWeight: FONTS.heavy,
    marginBottom: SPACING.xs,
  },
  subheading: {
    color: COLORS.textMuted,
    fontSize: 15,
    marginBottom: SPACING.xl,
  },
  form: { gap: SPACING.sm },
  input: {
    backgroundColor: COLORS.input,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    borderRadius: RADIUS.md,
    color: COLORS.textPrimary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    fontSize: 15,
  },
  bioInput: { minHeight: 84, textAlignVertical: "top" },
  error: {
    color: COLORS.error,
    fontSize: 13,
    paddingHorizontal: SPACING.xs,
  },
  btn: { marginTop: SPACING.sm },
  sectionLabel: {
    color: COLORS.textSecondary,
    fontSize: 14,
    fontWeight: FONTS.semibold,
    marginBottom: SPACING.xs,
    marginTop: SPACING.sm,
  },
  chipGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.inputBorder,
    backgroundColor: COLORS.surface,
  },
  chipActive: {
    backgroundColor: COLORS.accentFaint,
    borderColor: COLORS.accent,
  },
  chipText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: FONTS.medium,
  },
  chipTextActive: {
    color: COLORS.accent,
    fontWeight: FONTS.bold,
  },
  buttonRow: {
    flexDirection: "row",
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  rowBtn: { flex: 1 },
  switchRow: { alignItems: "center", marginTop: SPACING.xl },
  switchText: { color: COLORS.textMuted, fontSize: 14 },
  switchLink: { color: COLORS.accent, fontWeight: FONTS.bold },
});
