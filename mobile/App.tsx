import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from './src/session';
import { C } from './src/theme';
import { Loading, Screen } from './src/ui';
import Connect from './src/screens/Connect';
import Dashboard from './src/screens/Dashboard';
import MyBots from './src/screens/MyBots';
import AddBot from './src/screens/AddBot';
import ImportBot from './src/screens/ImportBot';
import BotDetails from './src/screens/BotDetails';
import Console from './src/screens/Console';
import Stats from './src/screens/Stats';
import Servers from './src/screens/Servers';
import Settings from './src/screens/Settings';
import Account from './src/screens/Account';

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.surface, text: C.text, border: C.border, primary: C.red } };
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();
const icons: Record<string, keyof typeof Ionicons.glyphMap> = { Dashboard: 'speedometer', 'My Bots': 'hardware-chip', Statistics: 'pulse', Server: 'server', Settings: 'settings' };

function Tabs() {
  return (
    <Tab.Navigator screenOptions={({ route }) => ({
      headerShown: false, tabBarActiveTintColor: C.red, tabBarInactiveTintColor: C.muted,
      tabBarStyle: { backgroundColor: C.surface, borderTopColor: C.border },
      tabBarIcon: ({ color, size }) => <Ionicons name={icons[route.name]} size={size} color={color} />,
    })}>
      <Tab.Screen name="Dashboard" component={Dashboard} />
      <Tab.Screen name="My Bots" component={MyBots} />
      <Tab.Screen name="Statistics" component={Stats} />
      <Tab.Screen name="Server" component={Servers} />
      <Tab.Screen name="Settings" component={Settings} />
    </Tab.Navigator>
  );
}

function Root() {
  const { ready, token } = useSession();
  if (!ready) return <Screen><Loading /></Screen>;
  if (!token) return <Connect />;
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: C.surface }, headerTintColor: C.text, contentStyle: { backgroundColor: C.bg } }}>
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="AddBot" component={AddBot} options={{ title: 'Add Bot' }} />
      <Stack.Screen name="ImportBot" component={ImportBot} options={{ title: 'Import Bot' }} />
      <Stack.Screen name="BotDetails" component={BotDetails} options={{ title: 'Bot Details' }} />
      <Stack.Screen name="Console" component={Console} options={({ route }: any) => ({ title: route.params?.name ? `Console · ${route.params.name}` : 'Live Console' })} />
      <Stack.Screen name="Account" component={Account} options={{ title: 'Account & Security' }} />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <NavigationContainer theme={theme}><StatusBar style="light" /><Root /></NavigationContainer>
      </SessionProvider>
    </SafeAreaProvider>
  );
}
