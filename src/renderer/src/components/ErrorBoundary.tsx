import React from 'react'
import { useAppStore } from '../stores/app-store'
import { translations } from '../i18n/translations'
export class ErrorBoundary extends React.Component<React.PropsWithChildren, {error:boolean}> { state={error:false}; static getDerivedStateFromError(){return {error:true}}; render(){const language = useAppStore.getState().settings?.language ?? 'ru'; const t = translations[language]; return this.state.error?<div className="fatal-error"><h1>{t.fatalTitle}</h1><p>{t.fatalDescription}</p><button onClick={()=>this.setState({error:false})}>{t.retry}</button></div>:this.props.children} }
