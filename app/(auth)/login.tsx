import React, { useRef, useState } from "react";
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
import { signInWithEmailAndPassword } from "firebase/auth";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth } from "@/config/firebase";
import { COLORS, SPACING, RADIUS, FONTS } from "@/constants/theme";
import GlowButton from "@/components/GlowButton";

function authErrorMessage(code: string): string {
  switch (code) {
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again later.";
    case "auth/network-request-failed":
      return "No network connection. Check your connection and try again.";
    default:
      return "Unable to sign in. Please try again.";
  }
}

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  async function handleLogin() {
    if (submittingRef.current) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !password) {
      setError("Email and password are required.");
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, trimmed, password);
      // AuthGuard in _layout.tsx will handle redirect
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      setError(authErrorMessage(code));
    } finally {
      submittingRef.current = false;
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
          <View style={styles.brand}>
            <View style={styles.logoMark}>
              <Text style={styles.logoBolt}>M</Text>
            </View>
            <Text style={styles.logo}>Momentum</Text>
            <Text style={styles.tagline}>Discover. Compete. Build momentum.</Text>
          </View>

          <View style={styles.form}>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={COLORS.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              value={email}
              onChangeText={(t) => { setEmail(t); setError(""); }}
              editable={!loading}
            />
            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={COLORS.textMuted}
              secureTextEntry
              textContentType="password"
              value={password}
              onChangeText={(t) => { setPassword(t); setError(""); }}
              editable={!loading}
              onSubmitEditing={handleLogin}
              returnKeyType="go"
            />

            {error ? (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}

            <GlowButton
              label="Login"
              onPress={handleLogin}
              loading={loading}
              disabled={loading}
              size="lg"
              style={styles.btn}
            />

            <Pressable
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Forgot password"
              style={({ pressed }) => [styles.forgotRow, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push("/(auth)/register")}
              accessibilityRole="link"
              accessibilityLabel="Create a new account"
              style={({ pressed }) => [styles.switchRow, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.switchText}>
                New here?{" "}
                <Text style={styles.switchLink}>Create Account</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: SPACING.xl,
  },
  brand: {
    alignItems: "center",
    marginBottom: SPACING.xxl,
  },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.accentFaint,
    borderWidth: 1,
    borderColor: COLORS.accent,
    marginBottom: SPACING.lg,
  },
  logoBolt: {
    color: COLORS.accent,
    fontSize: 30,
    fontWeight: FONTS.heavy,
  },
  logo: {
    color: COLORS.textPrimary,
    fontSize: 34,
    fontWeight: FONTS.heavy,
  },
  tagline: {
    color: COLORS.textMuted,
    fontSize: 14,
    marginTop: SPACING.sm,
    textAlign: "center",
  },
  form: {
    gap: SPACING.sm,
  },
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
  error: {
    color: COLORS.error,
    fontSize: 13,
    paddingHorizontal: SPACING.xs,
  },
  btn: { marginTop: SPACING.sm },
  forgotRow: {
    alignItems: "center",
    paddingVertical: SPACING.sm,
  },
  forgotText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontWeight: FONTS.semibold,
  },
  switchRow: {
    alignItems: "center",
    marginTop: SPACING.lg,
  },
  switchText: {
    color: COLORS.textMuted,
    fontSize: 14,
  },
  switchLink: {
    color: COLORS.accent,
    fontWeight: FONTS.bold,
  },
});
